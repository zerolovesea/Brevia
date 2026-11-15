// 排除常见虚词，保留单字专业名词；用户已确认的词条由调用方豁免。
function isTermCandidate(original) {
  return (
    typeof original === 'string' &&
    original === original.trim() &&
    original.length > 0 &&
    original.length <= 80 &&
    !/[，。！？；：,!?;:\r\n]/u.test(original) &&
    !/^(?:我|你|他|她|它|这个|那个|然后|其实)|(?:的是|的话|比较|因为|所以|指的是)/u.test(
      original,
    ) &&
    !/[的了着]$|的\s*[A-Za-z]/u.test(original) &&
    !/\b(?:is|are|was|were|has|have|will|can|should)\b/i.test(original) &&
    [...original.matchAll(/\p{Script=Han}/gu)].length <= 12 &&
    !/^[零〇一二三四五六七八九十百千万亿两幺点\d\s]+$/u.test(original) &&
    !/^(?:[其的了着地得而与和或也就都这那我你他她它吗呢吧啊嗯呃]|其他|然后|其实|这个|那个|我们|你们|他们)$/u.test(
      original,
    ) &&
    /[\p{L}]/u.test(original) &&
    !/^(?:the|a|an|it|its|this|that|these|those|and|or|of|to)$/i.test(original)
  );
}
function termIdentity(original) {
  return original
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\s.·_-]+/gu, '');
}
function distinctMentions(mentions) {
  const identities = new Set();
  const eligible = mentions.filter((m) =>
    m.name ? !m.scope || m.scope === (m.workspace_id || 'public') : isTermCandidate(m.original),
  );
  const confirmed = new Set(
    eligible
      .filter((m) => m.name)
      .map((m) => JSON.stringify([m.meeting_id, termIdentity(m.original)])),
  );
  // 短词优先，同一会议的缩写空格、大小写变体只询问一次；保留已确认词条。
  return eligible
    .sort((a, b) => a.original.length - b.original.length)
    .filter((m) => {
      if (m.name) return true;
      const id = JSON.stringify([m.meeting_id, termIdentity(m.original)]);
      if (identities.has(id) || confirmed.has(id)) return false;
      identities.add(id);
      return true;
    });
}
function containsTerm(text, original) {
  const pattern =
    (/^[a-z0-9]/i.test(original) ? '(?<![A-Za-z0-9_])' : '') +
    original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    (/[a-z0-9]$/i.test(original) ? '(?![A-Za-z0-9_])' : '');
  return new RegExp(pattern, 'u').test(text);
}
module.exports = { isTermCandidate, containsTerm, termIdentity, distinctMentions };
