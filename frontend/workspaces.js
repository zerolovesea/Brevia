/**
 * 工作区管理模块
 * 负责工作区的数据管理、UI 渲染和交互逻辑
 */

// 工作区数据
let workspaces = [];
let activeWorkspaceId = ''; // 空字符串表示公开工作区

function closeWorkspaceDialog(backdrop) {
  backdrop.classList.remove('modal-enter');
  backdrop.classList.add('modal-leave');
  setTimeout(() => {
    backdrop.remove();
    if (backdrop.returnFocus?.isConnected) backdrop.returnFocus.focus();
    document.body.classList.remove('modal-open');
  }, BreviaMotion.duration('exit'));
}

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
  const anchor = selector.getBoundingClientRect();
  const edge = document.querySelector('.sidebar').getBoundingClientRect().right;
  positionFloating(
    workspacePicker,
    { left: edge, right: edge, top: anchor.top, bottom: anchor.bottom },
    ['right-center', 'right-end', 'right-start', 'left-end'],
  );
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
  // 浮层留在侧栏内，鼠标和焦点移动到菜单时不会收起录制侧栏。
  document.querySelector('.sidebar').append(workspacePicker);
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
  workspacePicker.querySelector('input').focus({ preventScroll: true });
}
function renderWorkspaceNav() {
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;
  let container = nav.querySelector('.workspace-subnav');
  if (!container) {
    container = document.createElement('div');
    container.className = 'workspace-subnav workspace-container';
    container.id = 'workspace-subnav';
    nav.querySelector('#recently-deleted').after(container);
  }
  const name = getWorkspaceName(activeWorkspaceId);
  container.innerHTML = `<div class="workspace-subnav-content"><div class="workspace-heading"><h3>${escapeHtml(t('工作区'))}</h3><button class="new-workspace" type="button" data-new-workspace aria-label="${escapeHtml(t('新建工作区'))}" title="${escapeHtml(t('新建工作区'))}">${interfaceIcon('plus')}</button></div><button id="workspace-selector" type="button" class="workspace-item workspace-selector" data-workspace-id="${escapeHtml(activeWorkspaceId)}" aria-expanded="${Boolean(workspacePicker)}" aria-controls="workspace-picker" title="${escapeHtml(name)} (${workspaceMeetingCount(activeWorkspaceId)})">${interfaceIcon('folder')}<span class="workspace-label">${escapeHtml(name)}</span>${interfaceIcon('chevron-down')}</button></div>`;
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
 * 切换活跃工作区
 * @param {string} workspaceId - 工作区 ID
 */
async function switchWorkspace(workspaceId) {
  if (
    workspaceId === activeWorkspaceId &&
    activeLibraryNav === 'all-meetings' &&
    activeView === 'home' &&
    !pageTransition
  )
    return;
  if (activeView === 'live' && meetingActive) appActions.minimizeMeeting();
  const applyWorkspace = async () => {
    clearMeetingSelection();
    activeWorkspaceId = workspaceId;
    localStorage.setItem('brevia-active-workspace', workspaceId);
    appActions.selectLibraryNav('all-meetings');
    if (window.brevia) {
      try {
        await refreshBackendMeetings(false);
      } catch (error) {
        appActions.showToast(error.message, undefined, 'error');
      }
    }
    renderWorkspaceNav();
    updateHomeViewTitle();
    appActions.filterMeetings();
  };
  await appActions.transitionPage(
    document.querySelector(`#${activeView}-view`),
    document.querySelector('#home-view'),
    applyWorkspace,
  );
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
  if (eyebrow) eyebrow.textContent = deleted ? t('最近删除') : workspace?.name || t('会议库');
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
function showNewWorkspaceDialog(assignMeetingId, onCreated) {
  if (workspacePicker) closeWorkspacePicker(true);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop workspace-dialog';
  backdrop.returnFocus = document.activeElement;
  backdrop.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true">
      <header class="modal-head">
        <div class="modal-title">
          <h2>${t('新建工作区')}</h2>
          <p>${t('创建一个新的工作区来组织会议')}</p>
        </div>
        <button class="modal-close" type="button" data-close-modal aria-label="${t('关闭')}">${interfaceIcon('close')}</button>
      </header>
      <div class="modal-body">
        <form class="workspace-form" data-workspace-form>
          <label>
            ${t('工作区名称')}
            <input name="name" type="text" maxlength="30" required autofocus />
          </label>
          <label>
            <span>${t('描述')} <small>${t('（可选）')}</small></span>
            <textarea name="description" maxlength="100" rows="2"></textarea>
          </label>
          <div class="modal-form-actions">
            <button type="button" class="secondary" data-close-modal>${t('取消')}</button>
            <button type="submit" class="modal-action">${t('创建工作区')}</button>
          </div>
        </form>
      </div>
    </section>
  `;

  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');

  // 触发进入动画
  backdrop.classList.remove('modal-leave');
  backdrop.hidden = false;
  backdrop.classList.add('modal-enter');

  // 聚焦输入框
  setTimeout(() => {
    backdrop.querySelector('input[name="name"]').focus();
  }, 100);

  let escHandler;
  const closeDialog = () => {
    document.removeEventListener('keydown', escHandler);
    closeWorkspaceDialog(backdrop);
  };

  // 关闭按钮事件
  backdrop.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeDialog);
  });

  let backdropPointerDown = false;
  backdrop.addEventListener('pointerdown', (e) => {
    backdropPointerDown = e.target === backdrop;
  });
  // 仅当按下与松开都在背景上才关闭，避免拖出弹窗时误关。
  backdrop.addEventListener('click', (e) => {
    if (backdropPointerDown && e.target === backdrop) closeDialog();
    backdropPointerDown = false;
  });

  // ESC 键关闭
  escHandler = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // 提交表单
  backdrop.querySelector('[data-workspace-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    const formData = new FormData(e.target);
    const payload = {
      name: formData.get('name').trim(),
      description: formData.get('description').trim(),
    };

    try {
      const workspace = await window.brevia.workspace.create(payload);
      workspaces.push(workspace);
      workspaces.sort((a, b) => a.position - b.position);
      if (assignMeetingId) await assignMeetingToWorkspace(assignMeetingId, workspace.id);
      onCreated?.(workspace);
      renderWorkspaceNav();
      closeDialog();
      document.removeEventListener('keydown', escHandler);
      appActions.showToast(t('工作区已创建'), undefined, 'success');
    } catch (error) {
      appActions.showToast(error.message, undefined, 'error');
    } finally {
      submit.disabled = false;
    }
  });
}

/**
 * 显示工作区编辑对话框
 * @param {string} workspaceId - 工作区 ID
 */
function showEditWorkspaceDialog(workspaceId) {
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  const backdrop = document.createElement('div');
  const anchor = document.querySelector('#workspace-edit');
  const anchored = !anchor.hidden && activeView === 'home' && activeWorkspaceId === workspaceId;
  backdrop.className = `modal-backdrop workspace-dialog${anchored ? ' workspace-edit-popover' : ''}`;
  backdrop.returnFocus = document.activeElement;
  backdrop.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true" aria-label="${t('编辑工作区')}">
      <header class="modal-head">
        <div class="modal-title">
          <h2>${t('编辑工作区')}</h2>
          <p>${escapeHtml(workspace.name)}</p>
        </div>
        <button class="modal-close" type="button" data-close-modal aria-label="${t('关闭')}">${interfaceIcon('close')}</button>
      </header>
      <div class="modal-body">
        <form class="workspace-form" data-workspace-form>
          <label>
            ${t('工作区名称')}
            <input name="name" type="text" maxlength="30" value="${escapeHtml(workspace.name)}" required autofocus />
          </label>
          ${anchored ? `<details class="workspace-description"><summary>${t('描述')} ${t('（可选）')}${interfaceIcon('chevron-down')}</summary>` : ''}
          <label>
            ${anchored ? '' : `<span>${t('描述')} <small>${t('（可选）')}</small></span>`}
            <textarea name="description" aria-label="${t('描述')}" maxlength="100" rows="2">${escapeHtml(workspace.description)}</textarea>
          </label>
          ${anchored ? '</details>' : ''}
          <div class="modal-form-actions">
            <button type="button" class="secondary" data-close-modal>${t('取消')}</button>
            <button type="submit" class="modal-action">${t('保存更改')}</button>
            <button type="button" class="danger" data-delete-workspace>${t('删除工作区')}</button>
          </div>
        </form>
      </div>
    </section>
  `;

  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const panel = backdrop.querySelector('.modal-panel');
  const reposition = () => {
    if (anchored) positionFloating(panel, anchor, ['bottom-end', 'top-end']);
  };
  reposition();
  window.addEventListener('resize', reposition);

  // 触发进入动画
  backdrop.classList.remove('modal-leave');
  backdrop.hidden = false;
  backdrop.classList.add('modal-enter');

  // 聚焦输入框
  setTimeout(() => {
    backdrop.querySelector('input[name="name"]').focus();
  }, 100);

  let escHandler;
  const closeDialog = () => {
    document.removeEventListener('keydown', escHandler);
    window.removeEventListener('resize', reposition);
    closeWorkspaceDialog(backdrop);
  };

  // 关闭按钮事件
  backdrop.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeDialog);
  });

  let backdropPointerDown = false;
  backdrop.addEventListener('pointerdown', (e) => {
    backdropPointerDown = e.target === backdrop;
  });
  // 仅当按下与松开都在背景上才关闭，避免拖出弹窗时误关。
  backdrop.addEventListener('click', (e) => {
    if (backdropPointerDown && e.target === backdrop) closeDialog();
    backdropPointerDown = false;
  });

  // ESC 键关闭
  escHandler = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // 删除工作区
  backdrop.querySelector('[data-delete-workspace]').addEventListener('click', async () => {
    appActions.openConfirmation(
      t('删除工作区'),
      t('工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。'),
      async () => {
        try {
          await window.brevia.workspace.delete({ workspace_id: workspaceId });
          workspaces = workspaces.filter((w) => w.id !== workspaceId);
          if (activeWorkspaceId === workspaceId) void switchWorkspace('');
          uiData.meetings = uiData.meetings.filter(
            (meeting) => meeting.workspaceId !== workspaceId,
          );
          renderWorkspaceNav();
          appActions.renderMeetingList();
          closeDialog();
          document.removeEventListener('keydown', escHandler);
          appActions.showToast(t('工作区已删除'), undefined, 'success');
        } catch (error) {
          appActions.showToast(error.message, undefined, 'error');
        }
      },
    );
  });

  // 提交表单
  backdrop.querySelector('[data-workspace-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    const formData = new FormData(e.target);
    const updates = {
      name: formData.get('name').trim(),
      description: formData.get('description').trim(),
    };

    try {
      const updated = await window.brevia.workspace.update({ workspace_id: workspaceId, updates });
      const index = workspaces.findIndex((w) => w.id === workspaceId);
      if (index >= 0) workspaces[index] = updated;
      renderWorkspaceNav();
      updateHomeViewTitle();
      closeDialog();
      document.removeEventListener('keydown', escHandler);
      appActions.showToast(t('工作区已更新'), undefined, 'success');
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
  menu.querySelector('.active')?.focus({ preventScroll: true });
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
