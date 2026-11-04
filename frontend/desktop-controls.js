/** 新选择器保留字段提交，键盘操作只管理可见选项，不写入未确认的值。 */
document.addEventListener('keydown', (event) => {
  const select = event.target.closest?.('.ui-select');
  if (!select || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const trigger = select.querySelector('[data-flow-select-toggle]');
  const list = select.querySelector('.ui-select-list');
  if (!trigger || trigger.disabled || !list) return;
  event.preventDefault();
  event.stopPropagation();
  if (list.hidden) trigger.click();
  if (list.hidden) return;
  const options = [...list.querySelectorAll('[data-flow-select-choice]:not(:disabled)')];
  if (!options.length) return;
  const current = options.indexOf(document.activeElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : current < 0
          ? Math.max(
              0,
              options.findIndex((option) => option.hasAttribute('aria-current')),
            )
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
  options[next].focus({ preventScroll: true });
  options[next].scrollIntoView({ block: 'nearest' });
});
