#!/usr/bin/env node
/**
 * Claude Code LaTeX 渲染补丁
 *
 * 与原版 patch_extension.js 的区别：
 *   - 不修改任何 CSP 策略（仅追加 cspSource，允许扩展本地资源）
 *   - 只注入一个 <script> 标签加载本地 latex-render.js
 *   - KaTeX 文件全部来自本地，不依赖任何外部 CDN
 *   - 支持 --restore 恢复备份
 *
 * 修补两个文件：
 *   1. extension.js  → 注入 latex-render.js <script> 标签（WebView HTML 模板）
 *   2. webview/index.js → 在 parseMarkdown 前预处理 \[...\] \(...\) 为 Unicode 占位符
 *      （因为 marked.js 会把 \[ 解析为 [，导致 latex-render.js 无法匹配）
 *
 * 用法：
 *   node patch_latex.js           # 打补丁
 *   node patch_latex.js --restore # 恢复原始文件
 */

const fs   = require('fs');
const path = require('path');

// ─── 找扩展目录 ────────────────────────────────────────────────────────────────

function findExtensionDir() {
  const home    = process.env.HOME || process.env.USERPROFILE;
  const extBase = path.join(home, '.vscode-server', 'extensions');

  if (!fs.existsSync(extBase)) {
    // 也兼容 Windows 本地 VSCode
    const winBase = path.join(home, '.vscode', 'extensions');
    if (fs.existsSync(winBase)) return pickLatest(winBase);
    console.error('[Patch] 未找到 VSCode extensions 目录');
    process.exit(1);
  }
  return pickLatest(extBase);
}

function pickLatest(extBase) {
  const dirs = fs.readdirSync(extBase).filter(d => d.startsWith('anthropic.claude-code-'));
  if (dirs.length === 0) {
    console.error('[Patch] 未找到 Claude Code 扩展');
    process.exit(1);
  }
  return path.join(extBase, dirs.sort().pop());
}

// ─── 恢复备份 ──────────────────────────────────────────────────────────────────

function restore(extDir) {
  const extJs  = path.join(extDir, 'extension.js');
  const extBak = path.join(extDir, 'extension.js.bak');
  const idxJs  = path.join(extDir, 'webview', 'index.js');
  const idxBak = path.join(extDir, 'webview', 'index.js.bak');

  let restored = false;

  if (fs.existsSync(extBak)) {
    fs.copyFileSync(extBak, extJs);
    console.log('[Restore] 已恢复 extension.js');
    restored = true;
  } else {
    console.log('[Restore] 未找到 extension.js.bak，跳过');
  }

  if (fs.existsSync(idxBak)) {
    fs.copyFileSync(idxBak, idxJs);
    console.log('[Restore] 已恢复 webview/index.js');
    restored = true;
  } else {
    console.log('[Restore] 未找到 webview/index.js.bak，跳过');
  }

  if (restored) {
    console.log('[Restore] 完成，请在 VSCode 中执行: Developer: Reload Window');
  } else {
    console.error('[Restore] 未找到任何备份文件');
    process.exit(1);
  }
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────

const RESTORE = process.argv.includes('--restore');
const extDir  = findExtensionDir();
console.log('[Patch] 扩展目录:', extDir);

if (RESTORE) { restore(extDir); process.exit(0); }

const extensionJs  = path.join(extDir, 'extension.js');
const extensionBak = path.join(extDir, 'extension.js.bak');
const webviewDir   = path.join(extDir, 'webview');
const indexJs      = path.join(webviewDir, 'index.js');
const indexBak     = path.join(webviewDir, 'index.js.bak');

// ─── 步骤 1：复制本地 KaTeX 文件 ─────────────────────────────────────────────

const srcDir = path.join(__dirname, 'webview');

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[Patch] 源文件不存在: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyFile(path.join(srcDir, 'latex-render.js'), path.join(webviewDir, 'latex-render.js'));
copyFile(path.join(srcDir, 'katex.min.js'),    path.join(webviewDir, 'katex.min.js'));
copyFile(path.join(srcDir, 'katex.min.css'),   path.join(webviewDir, 'katex.min.css'));
copyDir(path.join(srcDir, 'fonts'),            path.join(webviewDir, 'fonts'));
console.log('[Patch] KaTeX 文件已复制到扩展 webview 目录');

// ─── 步骤 2：读取 extension.js 并检查是否已打过补丁 ──────────────────────────

let extContent = fs.readFileSync(extensionJs, 'utf8');
const extAlreadyPatched = extContent.includes('latex-render.js');

if (extAlreadyPatched) {
  console.log('[Patch] extension.js 检测到已注入 latex-render.js，跳过。');
}

// ─── 步骤 2b：读取 index.js 并检查是否已打过补丁 ─────────────────────────────

if (!fs.existsSync(indexJs)) {
  console.error(`[Patch] 未找到 webview/index.js: ${indexJs}`);
  process.exit(1);
}

let idxContent = fs.readFileSync(indexJs, 'utf8');
const idxAlreadyPatched = idxContent.includes('__latex_preprocess__');

if (idxAlreadyPatched) {
  console.log('[Patch] webview/index.js 检测到已注入 __latex_preprocess__，跳过。');
}

if (extAlreadyPatched && idxAlreadyPatched) {
  console.log('[Patch] 两个文件均已打过补丁，无需重复操作。');
  console.log('[Patch] 若需重打，请先运行: node patch_latex.js --restore');
  process.exit(0);
}

// ─── 步骤 3：解析 extension.js 内部变量名 ─────────────────────────────────────
//
// 在 extension.js 中寻找形如：
//   Uri.joinPath(this.extensionUri,"webview","index.js"),<srcVar>=<webviewObj>.asWebviewUri
// 以提取：
//   - webviewObj: 持有 asWebviewUri 方法的变量（通常为 z）
//   - vscodeUri:  F4.Uri.joinPath 中的 F4（vscode 模块别名）
//
// 以及注入点：
//   nonce="${<nonceVar>}" src="${<srcVar>}" type="module"></script>

const uriPattern = /(\w+)\.Uri\.joinPath\(this\.extensionUri,"webview","index\.js"\),(\w+)=(\w+)\.asWebviewUri/;
const uriMatch = extContent.match(uriPattern);
if (!uriMatch && !extAlreadyPatched) {
  console.error('[Patch] 无法解析扩展内部变量名（extensionUri 上下文未找到）。');
  console.error('[Patch] 当前扩展版本可能不兼容，请检查 extension.js 是否结构发生变化。');
  process.exit(1);
}

const scriptPattern = /nonce="\$\{(\w+)\}" src="\$\{(\w+)\}" type="module"><\/script>/;
const scriptMatch = extContent.match(scriptPattern);
if (!scriptMatch && !extAlreadyPatched) {
  console.error('[Patch] 未找到 <script> 注入点。');
  process.exit(1);
}

// ─── 步骤 4：备份 extension.js 并注入 ────────────────────────────────────────

if (!extAlreadyPatched) {
  const [, vscodeUri, , webviewObj] = uriMatch;
  const [fullMatch, nonceVar] = scriptMatch;

  console.log(`[Patch] 解析到变量名: vscodeUri=${vscodeUri}, webviewObj=${webviewObj}`);
  console.log(`[Patch] 解析到注入点 nonce 变量: ${nonceVar}`);

  if (!fs.existsSync(extensionBak)) {
    fs.copyFileSync(extensionJs, extensionBak);
    console.log('[Patch] 已备份 extension.js → extension.js.bak');
  } else {
    console.log('[Patch] extension.js.bak 已存在，跳过备份');
  }

  // 步骤 4a：修改 script-src，追加 cspSource
  const scriptSrcRe = new RegExp(`script-src 'nonce-\\$\\{${nonceVar}\\}'`);
  if (scriptSrcRe.test(extContent)) {
    extContent = extContent.replace(
      scriptSrcRe,
      `script-src 'nonce-\${${nonceVar}}' \${${webviewObj}.cspSource}`
    );
    console.log('[Patch] 已更新 script-src CSP（追加 cspSource）');
  } else {
    console.log('[Patch] script-src：未找到目标模式，跳过');
  }

  // 步骤 4b（主）：注入 __KATEX_BASE__ 内联脚本 + latex-render.js 外部脚本
  const injection =
    `${fullMatch}` +
    `<script nonce="\${${nonceVar}}">window.__KATEX_BASE__="\${${webviewObj}.asWebviewUri(${vscodeUri}.Uri.joinPath(this.extensionUri,"webview"))}";</script>` +
    `<script nonce="\${${nonceVar}}" src="\${${webviewObj}.asWebviewUri(${vscodeUri}.Uri.joinPath(this.extensionUri,"webview","latex-render.js"))}"></script>`;

  extContent = extContent.replace(fullMatch, injection);
  fs.writeFileSync(extensionJs, extContent, 'utf8');
  console.log('[Patch] extension.js 已注入 latex-render.js');
}

// ─── 步骤 5：修补 webview/index.js（react-markdown 渲染前预处理） ────────────
//
// Claude Code 使用 react-markdown（remark/unified 管线）渲染输出，
// remark-parse 对 \[ \] \( \) 做转义处理，导致 latex-render.js 无法匹配。
//
// 注入点：react-markdown 组件把 markdown 字符串赋值给 VFile 之前：
//   if(typeof <VAR>==="string")<VFILE>.value=<VAR>
//
// 在赋值前把源字符串中的序列替换为 Unicode 占位符：
//   \[  →  ⟦ (U+27E6)    \]  →  ⟧ (U+27E7)
//   \(  →  ⟨ (U+27E8)    \)  →  ⟩ (U+27E9)
//
// latex-render.js 已对应添加这两种占位符的渲染规则。

if (!idxAlreadyPatched) {
  // 注入点在 VFile 赋值语句前（全文唯一）
  // 支持多个版本的模式：新版在前，旧版兜底
  //   模式格式: if(typeof <VAR>==="string")<VFILE>.value=<VAR>
  //   其中 <VAR> 是需要预处理的 markdown 字符串变量名
  const idxTargets = [
    'if(typeof n==="string")f.value=n',  // v2.1.191+
    'if(typeof Y==="string")F.value=Y',  // v2.1.31 (legacy)
  ];

  let idxTargetIdx = -1;
  let matchedTarget = '';
  for (const target of idxTargets) {
    idxTargetIdx = idxContent.indexOf(target);
    if (idxTargetIdx !== -1) {
      matchedTarget = target;
      break;
    }
  }

  if (idxTargetIdx === -1) {
    console.error('[Patch] webview/index.js：未找到 react-markdown 注入点，跳过。');
    console.error('[Patch] 扩展版本可能已更新，请检查 index.js 结构。');
    console.error('[Patch] 尝试过的模式:', idxTargets.join(', '));
  } else {
    // 从匹配模式中提取 markdown 字符串变量名
    // 模式: if(typeof <VAR>==="string")... → 取 <VAR>
    const varMatch = matchedTarget.match(/typeof (\w+)===/);
    const markdownVar = varMatch ? varMatch[1] : 'n';
    console.log(`[Patch] webview/index.js 注入点已找到（react-markdown VFile 赋值，变量名=${markdownVar}）`);

    if (!fs.existsSync(indexBak)) {
      fs.copyFileSync(indexJs, indexBak);
      console.log('[Patch] 已备份 webview/index.js → webview/index.js.bak');
    } else {
      console.log('[Patch] webview/index.js.bak 已存在，跳过备份');
    }

    // 使用 String.fromCharCode(92) 构造反斜杠，避免补丁脚本自身触发转义
    const bs = String.fromCharCode(92);
    const preprocessCode =
      `${markdownVar}=${markdownVar}.replace(/${bs}${bs}${bs}[/g,'⟦')` +
      `.replace(/${bs}${bs}${bs}]/g,'⟧')` +
      `.replace(/${bs}${bs}${bs}(/g,'⟨')` +
      `.replace(/${bs}${bs}${bs})/g,'⟩');` +
      `/*__latex_preprocess__*/`;

    // 在赋值语句前插入预处理
    idxContent = idxContent.replace(matchedTarget, preprocessCode + matchedTarget);
    fs.writeFileSync(indexJs, idxContent, 'utf8');
    console.log('[Patch] webview/index.js 已注入 LaTeX 预处理代码');
  }
}

console.log('[Patch] 完成！请在 VSCode 中执行: Developer: Reload Window');
