/**
 * 工作区管理模块
 * 负责工作区的数据管理、UI 渲染和交互逻辑
 */

// 工作区数据
let workspaces = [];
let activeWorkspaceId = ''; // 空字符串表示公开工作区
const collapsedSidebarWorkspaces = new Set();

/**
 * 初始化工作区数据
 * @param {Array} workspaceList - 从后端获取的工作区列表
 */
function initializeWorkspaces(workspaceList) {
  workspaces = workspaceList || [];
  const savedActiveId = localStorage.getItem('brevia-active-workspace');
  if (savedActiveId === '' || workspaces.some((w) => w.id === savedActiveId)) {
    activeWorkspaceId = savedActiveId || '';
  } else {
    activeWorkspaceId = '';
  }
}

/**
 * 获取工作区显示名称
 * @param {string} workspaceId - 工作区 ID，空字符串表示公开工作区
 * @returns {string} 工作区名称
 */
function getWorkspaceName(workspaceId) {
  if (!workspaceId) return t('公开工作区');
  const workspace = workspaces.find((w) => w.id === workspaceId);
  return workspace?.name || t('未知工作区');
}

/**
 * 渲染侧边栏工作区导航
 */
let workspacePicker = null;
function closeWorkspacePicker(restoreFocus = false) {
  const closing = workspacePicker;
  if (closing) {
    closing.inert = true;
    BreviaMotion.leave(closing, () => closing.remove());
  }
  workspacePicker = null;
  const selector = document.querySelector('#workspace-selector');
  selector?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) selector?.focus({ preventScroll: true });
}
function workspaceMeetingCount(workspaceId) {
  return (uiData.meetings || []).filter(
    (meeting) =>
      !meeting.deleted &&
      (!meeting.isExample || meeting.exampleLocale === locale) &&
      (meeting.workspaceId || '') === workspaceId,
  ).length;
}
function renderWorkspacePickerItems() {
  if (!workspacePicker) return;
  const query = workspacePicker.querySelector('input').value.trim().toLocaleLowerCase();
  const items = [{ id: '', name: t('公开工作区') }, ...workspaces].filter((item) =>
    item.name.toLocaleLowerCase().includes(query),
  );
  workspacePicker.querySelector('.workspace-picker-list').innerHTML =
    items
      .map(
        (item) =>
          `<button type="button" class="workspace-item${item.id === activeWorkspaceId ? ' active' : ''}" data-workspace-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)} (${workspaceMeetingCount(item.id)})" aria-current="${item.id === activeWorkspaceId}">${interfaceIcon('folder')}<span class="workspace-label">${escapeHtml(item.name)}</span>${item.id === activeWorkspaceId ? interfaceIcon('check') : ''}</button>`,
      )
      .join('') || `<p class="page-empty">${escapeHtml(t('没有搜索结果'))}</p>`;
}
function positionWorkspacePicker(selector) {
  positionFloating(workspacePicker, selector, ['bottom-start', 'top-start']);
}
function toggleWorkspacePicker() {
  if (workspacePicker) return closeWorkspacePicker(true);
  const selector = document.querySelector('#workspace-selector');
  workspacePicker = document.createElement('section');
  workspacePicker.className = 'workspace-picker';
  workspacePicker.id = 'workspace-picker';
  workspacePicker.setAttribute('popover', 'manual');
  workspacePicker.setAttribute('aria-label', t('工作区'));
  workspacePicker.innerHTML = `<label class="search">${interfaceIcon('search')}<input type="search" placeholder="${escapeHtml(t('搜索工作区'))}" aria-label="${escapeHtml(t('搜索工作区'))}" /></label><div class="workspace-picker-list"></div><button type="button" data-new-workspace>${interfaceIcon('plus')}${escapeHtml(t('新建工作区'))}</button>`;
  // 浮层留在会议导航内，工作区切换不会改变当前工作面的宽度。
  document.querySelector('.library-panel').append(workspacePicker);
  workspacePicker.showPopover();
  selector.setAttribute('aria-expanded', 'true');
  renderWorkspacePickerItems();
  positionWorkspacePicker(selector);
  workspacePicker.querySelector('input').addEventListener('input', renderWorkspacePickerItems);
  workspacePicker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeWorkspacePicker(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const choices = [...workspacePicker.querySelectorAll('.workspace-item')];
    if (!choices.length) return;
    const current = choices.indexOf(document.activeElement);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? choices.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    event.preventDefault();
    choices[index].focus({ preventScroll: true });
    choices[index].scrollIntoView({ block: 'nearest' });
  });
}
function renderWorkspaceNav() {
  const container = document.querySelector('.library-panel .workspace-container');
  if (!container) return;
  container.classList.add('workspace-subnav');
  container.id = 'workspace-subnav';
  container.innerHTML = `<div class="workspace-subnav-content"><div class="workspace-heading navigation-section-heading"><button id="workspace-selector" type="button" class="workspace-selector" aria-label="${escapeHtml(t('工作区'))}" aria-expanded="${Boolean(workspacePicker)}" aria-controls="workspace-picker"><span>${escapeHtml(t('工作区'))}</span>${interfaceIcon('chevron-down')}</button><button class="new-workspace" type="button" data-new-workspace aria-label="${escapeHtml(t('新建工作区'))}" title="${escapeHtml(t('新建工作区'))}">${interfaceIcon('plus')}</button></div></div>`;
  if (workspacePicker) {
    renderWorkspacePickerItems();
    positionWorkspacePicker(container.querySelector('#workspace-selector'));
  }
}
document.addEventListener('click', (event) => {
  if (workspacePicker && !event.target.closest('.workspace-picker, #workspace-selector'))
    closeWorkspacePicker();
});
window.addEventListener('resize', () => closeWorkspacePicker());

/**
 * 选择新会议的默认工作区，不离开当前文档或停止录音
 * @param {string} workspaceId - 工作区 ID
 */
async function switchWorkspace(workspaceId) {
  activeWorkspaceId = workspaceId;
  localStorage.setItem('brevia-active-workspace', workspaceId);
  renderWorkspaceNav();
  updateHomeViewTitle();
  appActions.filterMeetings();
}

const clearWorkspaceDropTarget = () =>
  document
    .querySelectorAll('.workspace-item.is-drop-target')
    .forEach((item) => item.classList.remove('is-drop-target'));
document.addEventListener('dragover', (event) => {
  const target = event.target.closest('.workspace-item');
  if (!target || !event.dataTransfer.types.includes('text/plain')) return;
  event.preventDefault();
  clearWorkspaceDropTarget();
  target.classList.add('is-drop-target');
  if (target.id === 'workspace-selector' && !workspacePicker) toggleWorkspacePicker();
});
document.addEventListener('dragleave', (event) => {
  const target = event.target.closest('.workspace-item');
  if (target && !target.contains(event.relatedTarget)) target.classList.remove('is-drop-target');
});
document.addEventListener('dragend', clearWorkspaceDropTarget);
document.addEventListener('drop', async (event) => {
  const target = event.target.closest('.workspace-item');
  if (!target) return;
  event.preventDefault();
  clearWorkspaceDropTarget();
  const meeting = uiData.meetings.find(({ id }) => id === event.dataTransfer.getData('text/plain'));
  if (!meeting || meeting.deleted) return;
  const workspaceId = target.dataset.workspaceId || '';
  if (meeting.workspaceId === workspaceId) return;
  try {
    await window.brevia.workspace.assign({
      meeting_id: meeting.id,
      workspace_id: workspaceId || null,
    });
    const previousWorkspace = workspaces.find(({ id }) => id === meeting.workspaceId);
    const nextWorkspace = workspaces.find(({ id }) => id === workspaceId);
    if (previousWorkspace)
      previousWorkspace.meeting_count = Math.max(0, previousWorkspace.meeting_count - 1);
    if (nextWorkspace) nextWorkspace.meeting_count += 1;
    meeting.workspaceId = workspaceId;
    meeting.workspace = workspaceId ? { name: getWorkspaceName(workspaceId) } : null;
    document.querySelectorAll('.meeting-workspace-menu').forEach((menu) => menu.remove());
    closeMeetingMenus();
    renderWorkspaceNav();
    appActions.renderMeetingList();
  } catch (error) {
    appActions.showToast(error.message, undefined, 'error');
  }
});

/**
 * 更新主页标题显示当前工作区
 */
function updateHomeViewTitle() {
  const eyebrow = document.querySelector('#home-eyebrow');
  const slogan = document.querySelector('#home-slogan');
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const deleted = activeLibraryNav === 'recently-deleted';
  if (eyebrow) eyebrow.textContent = deleted ? t('最近删除') : t('会议库');
  if (slogan)
    slogan.textContent = deleted
      ? BreviaI18n.trashCopy(locale).slogan
      : workspace?.description || t('所有对话，清晰归档。');
  document.querySelector('#workspace-edit').hidden = !workspace || deleted;
}
document
  .querySelector('#workspace-edit')
  .addEventListener('click', () => showEditWorkspaceDialog(activeWorkspaceId));

/**
 * 显示新建工作区对话框
 */
function showNewWorkspaceDialog(assignMeetingId, onCreated, trigger) {
  showWorkspaceForm({ assignMeetingId, onCreated, trigger });
}
function showEditWorkspaceDialog(workspaceId, trigger) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return;
  const editButton = document.querySelector(
    `[data-edit-sidebar-workspace="${CSS.escape(workspaceId)}"]`,
  );
  showWorkspaceForm({ workspace, trigger: trigger || editButton });
}
function showWorkspaceForm({ assignMeetingId, onCreated, trigger, workspace }) {
  const title = t(workspace ? '编辑工作区' : '新建工作区');
  document.querySelector('.workspace-create-popover:popover-open')?.hidePopover();
  let anchor = trigger;
  if (anchor?.closest('.workspace-picker')) anchor = document.querySelector('#workspace-selector');
  if (anchor?.closest('.meeting-workspace-menu'))
    anchor = document.querySelector(`[data-meeting-menu="${trigger.dataset.meetingIndex}"]`);
  if (!anchor?.getClientRects().length || anchor === document.body)
    anchor = document.querySelector('.new-workspace');
  const selectName = anchor?.closest('.flow-select')?.querySelector('input[name]')?.name;
  const focusTarget = () =>
    (selectName &&
      document
        .querySelector(`.flow-select input[name="${CSS.escape(selectName)}"]`)
        ?.closest('.flow-select')
        ?.querySelector('.flow-select-toggle')) ||
    (anchor?.isConnected && anchor) ||
    (workspace &&
      document.querySelector(`[data-edit-sidebar-workspace="${CSS.escape(workspace.id)}"]`)) ||
    document.querySelector('.new-workspace') ||
    document.querySelector('#library-toggle');
  if (workspacePicker) closeWorkspacePicker();
  closeMeetingMenus(true);
  const popover = document.createElement('section');
  popover.className = 'workspace-dialog workspace-create-popover';
  popover.setAttribute('popover', 'auto');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', title);
  popover.innerHTML = `
      <header class="ui-dialog-header">
        <div class="ui-dialog-title">
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="modal-close" type="button" data-close-modal aria-label="${t('关闭')}">${interfaceIcon('close')}</button>
      </header>
      <div class="ui-dialog-body">
        <form class="workspace-form ui-dialog-form" data-workspace-form>
          <label>
            ${t('工作区名称')}
            <input name="name" type="text" maxlength="30" value="${escapeHtml(workspace?.name || '')}" required autofocus autocomplete="off" />
          </label>
          <details class="workspace-description">
            <summary>${interfaceIcon('chevron-down')}<span>${t('描述')}</span></summary>
            <textarea name="description" maxlength="100" rows="2" aria-label="${t('描述')}">${escapeHtml(workspace?.description || '')}</textarea>
          </details>
          <div class="ui-dialog-actions">
             ${workspace ? `<button type="button" class="ui-button ui-button-danger" data-delete-workspace>${t('删除工作区')}</button>` : ''}
            <button type="submit" class="ui-button ui-button-primary">${t(workspace ? '保存更改' : '创建工作区')}</button>
          </div>
        </form>
      </div>
  `;
  const closeDialog = () => {
    if (popover.matches(':popover-open')) popover.hidePopover();
  };
  const reposition = () => {
    if (!popover.matches(':popover-open')) return;
    const reference = focusTarget();
    if (!reference?.getClientRects().length) {
      popover.style.left = `${Math.max(8, (innerWidth - popover.offsetWidth) / 2)}px`;
      popover.style.top = `${Math.max(8, (innerHeight - popover.offsetHeight) / 2)}px`;
      return;
    }
    const rect = reference.getBoundingClientRect();
    const sidebar = reference.closest('.library-panel');
    if (sidebar) {
      const edge = sidebar.getBoundingClientRect().right + 8;
      positionFloating(popover, {
        left: rect.left - 8,
        right: edge,
        top: rect.top,
        bottom: rect.bottom,
      });
    } else
      positionFloating(popover, reference, ['bottom-start', 'top-start', 'bottom-end', 'top-end']);
  };
  popover.querySelector('[data-close-modal]').addEventListener('click', closeDialog);
  popover.querySelector('details').addEventListener('toggle', reposition);
  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  // 原生顶层负责 Esc 与外部点击；关闭后仅在焦点没有转交给其他控件时恢复入口。
  popover.addEventListener('toggle', (event) => {
    if (event.newState !== 'closed') return;
    window.removeEventListener('resize', reposition);
    document.removeEventListener('scroll', reposition, true);
    const restoreFocus =
      popover.contains(document.activeElement) || document.activeElement === document.body;
    popover.remove();
    if (restoreFocus) focusTarget()?.focus({ preventScroll: true });
  });
  document.body.appendChild(popover);
  focusTarget()?.focus({ preventScroll: true });
  popover.showPopover();
  reposition();
  BreviaMotion.enter(popover, 'settings');
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);

  // 删除工作区
  popover.querySelector('[data-delete-workspace]')?.addEventListener('click', (event) => {
    const deleteButton = event.currentTarget;
    appActions.openConfirmation(
      t('删除工作区'),
      t('工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。'),
      async () => {
        popover.inert = true;
        try {
          await window.brevia.workspace.delete({ workspace_id: workspace.id });
          closeDialog();
          workspaces = workspaces.filter((w) => w.id !== workspace.id);
          if (activeWorkspaceId === workspace.id) void switchWorkspace('');
          uiData.meetings = uiData.meetings.filter(
            (meeting) => meeting.workspaceId !== workspace.id,
          );
          renderWorkspaceNav();
          appActions.renderMeetingList();
          appActions.showToast(t('工作区已删除'), undefined, 'success');
        } catch (error) {
          popover.inert = false;
          deleteButton.focus({ preventScroll: true });
          appActions.showToast(error.message, undefined, 'error');
        }
      },
      deleteButton,
    );
  });

  popover.querySelector('[data-workspace-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector('[type="submit"]');
    if (submit.disabled) return;
    const name = e.target.elements.name;
    name.value = name.value.trim();
    if (!e.target.reportValidity()) return;
    submit.disabled = true;
    const formData = new FormData(e.target);
    const payload = {
      name: formData.get('name').trim(),
      description: formData.get('description').trim(),
    };

    try {
      if (workspace) {
        const updated = await window.brevia.workspace.update({
          workspace_id: workspace.id,
          updates: payload,
        });
        const index = workspaces.findIndex((item) => item.id === workspace.id);
        if (index >= 0) workspaces[index] = updated;
        renderWorkspaceNav();
        appActions.renderMeetingList();
        updateHomeViewTitle();
        closeDialog();
        appActions.showToast(t('工作区已更新'), undefined, 'success');
        return;
      }
      const created = await window.brevia.workspace.create(payload);
      workspaces.push(created);
      workspaces.sort((a, b) => a.position - b.position);
      if (assignMeetingId) await assignMeetingToWorkspace(assignMeetingId, created.id);
      onCreated?.(created);
      renderWorkspaceNav();
      appActions.renderMeetingList();
      closeDialog();
      appActions.showToast(t('工作区已创建'), undefined, 'success');
    } catch (error) {
      appActions.showToast(error.message, undefined, 'error');
    } finally {
      submit.disabled = false;
    }
  });
}

/**
 * 显示会议工作区分配菜单
 * @param {number} meetingIndex - 会议在 uiData.meetings 中的索引
 * @param {DOMRect} anchorRect - 菜单锚点位置
 */
function showWorkspaceAssignMenu(meetingIndex, anchorRect) {
  const meeting = uiData.meetings[meetingIndex];
  if (!meeting) return;

  const menu = document.createElement('div');
  menu.className = 'meeting-workspace-menu';
  menu.dataset.meetingIndex = meetingIndex;
  menu.innerHTML = `
    <h3>${escapeHtml(t('移至工作区'))}</h3><div class="menu-section">
      ${[{ id: '', name: t('公开工作区') }, ...workspaces]
        .map(
          (workspace) => `
        <button type="button"
                data-assign-workspace="${escapeHtml(workspace.id)}"
                data-meeting-index="${meetingIndex}"
                class="menu-item ${meeting.workspaceId === workspace.id ? 'active' : ''}">
          <span class="workspace-icon">${interfaceIcon('folder')}</span>
          <span>${escapeHtml(workspace.name)}</span>
          ${meeting.workspaceId === workspace.id ? `<span class="check">${checkIconSvg}</span>` : ''}
        </button>
      `,
        )
        .join('')}
    </div>
    <div class="menu-separator"></div>
    <button type="button" data-new-workspace-assign data-meeting-index="${meetingIndex}" class="menu-item">
      ${interfaceIcon('plus')} ${t('新建工作区')}
    </button>
  `;

  // 定位菜单
  menu.style.position = 'fixed';

  document.querySelectorAll('.meeting-workspace-menu').forEach((node) => node.remove());
  document.body.appendChild(menu);
  positionWorkspaceAssignMenu(menu, anchorRect);
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      menu.remove();
      document.querySelector('[data-meeting-menu=\"' + meetingIndex + '\"]')?.focus();
    }
  });

  return menu;
}

// 滚动或缩放后重新读取主菜单位置，保持连接与键盘焦点。
function positionWorkspaceAssignMenu(menu, fallbackRect) {
  const action = document.querySelector(
    `[data-meeting-action="workspace"][data-meeting-index="${menu.dataset.meetingIndex}"]`,
  );
  const anchor = action?.getBoundingClientRect() || fallbackRect;
  const parent = action?.closest('.meeting-menu').getBoundingClientRect() || fallbackRect;
  if (!parent || !anchor) return;
  const top = Math.max(8, parent.top);
  menu.style.maxHeight = `${innerHeight - top - 8}px`;
  const opensLeft = parent.left >= menu.offsetWidth + 16;
  const left = opensLeft ? parent.left - menu.offsetWidth - 8 : parent.right + 8;
  menu.style.left = `${Math.max(8, Math.min(left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${top}px`;
  menu.style.setProperty(
    '--submenu-connector-top',
    `${Math.max(16, Math.min(anchor.top + anchor.height / 2 - top, menu.offsetHeight - 16))}px`,
  );
  menu.classList.toggle('opens-left', opensLeft);
}

/**
 * 分配会议到工作区
 * @param {string} meetingId - 会议 ID
 * @param {string} workspaceId - 工作区 ID
 */
async function assignMeetingToWorkspace(meetingId, workspaceId) {
  if (uiData.meetings.find((meeting) => meeting.id === meetingId)?.workspaceId === workspaceId) {
    closeMeetingMenus();
    document.querySelectorAll('.meeting-workspace-menu').forEach((menu) => menu.remove());
    return;
  }
  try {
    await window.brevia.workspace.assign({
      meeting_id: meetingId,
      workspace_id: workspaceId || null,
    });

    // 更新本地数据
    const meeting = uiData.meetings.find((m) => m.id === meetingId);
    if (meeting) {
      meeting.workspaceId = workspaceId;
      meeting.workspace = workspaceId
        ? {
            name: getWorkspaceName(workspaceId),
          }
        : null;
    }

    closeMeetingMenus();
    renderWorkspaceNav();
    appActions.renderMeetingList();
    appActions.showToast(t('已移至') + ' ' + getWorkspaceName(workspaceId), undefined, 'success');
  } catch (error) {
    appActions.showToast(error.message, undefined, 'error');
  }
}
