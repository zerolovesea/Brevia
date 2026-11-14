// 术语只替换正文；保留链接、代码和 Markdown 结构，避免复制或导出后改变原意。
function replaceGlossaryMarkdown(markdown, mentions) {
  if (typeof markdown !== 'string' || !mentions.length) return markdown;
  const names = new Map(mentions.map(({ original, name }) => [original, name]));
  const re = new RegExp(
    '(?<protected>!?\\[[^\\]\\n]*\\]\\([^)\\n]+\\)|(?<ticks>`+)[^\\n]*?\\k<ticks>(?!`)|<[^>\\n]*>|https?://[^\\s<>]+|〔[\\d:·,，–—\\s-]+〕|\\[[\\d:·,，–—\\s-]+\\])|(?<term>' +
      [...names.keys()]
        .sort((a, b) => b.length - a.length)
        .map(
          (original) =>
            (/^[a-z0-9]/i.test(original) ? '(?<![A-Za-z0-9_])' : '') +
            original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            (/[a-z0-9]$/i.test(original) ? '(?![A-Za-z0-9_])' : ''),
        )
        .join('|') +
      ')',
    'gu',
  );
  let fence;
  return markdown
    .split('\n')
    .map((line) => {
      const delimiter = line.trimStart().match(/^(`{3,}|~{3,})/);
      if (fence) {
        if (
          delimiter &&
          delimiter[1][0] === fence[0] &&
          delimiter[1].length >= fence.length &&
          !line.trim().slice(delimiter[1].length)
        )
          fence = null;
        return line;
      }
      if (delimiter) {
        fence = delimiter[1];
        return line;
      }
      if (/^\s*\[[^\]]+\]:\s*/.test(line)) return line;
      return line.replace(re, (original, ...args) =>
        args.at(-1).protected
          ? original
          : names
              .get(original)
              .replace(/[\r\n]+/g, ' ')
              .replace(/&/g, '&amp;')
              .replace(/[\\`*_[\]{}()<>#!|.+=~-]/g, '\\$&'),
      );
    })
    .join('\n');
}
if (typeof module !== 'undefined') module.exports = { replaceGlossaryMarkdown };
