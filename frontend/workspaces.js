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
    document.body.classList.remove('modal-open');
  }, 200);
}

/**
 * 初始化工作区数据
 * @param {Array} workspaceList - 从后端获取的工作区列表
 */
function initializeWorkspaces(workspaceList) {
  workspaces = workspaceList || [];
  const savedActiveId = localStorage.getItem('brevia-active-workspace');
  if (savedActiveId === '' || workspaces.some(w => w.id === savedActiveId)) {
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
  const workspace = workspaces.find(w => w.id === workspaceId);
  return workspace?.name || t('未知工作区');
}

/**
 * 渲染侧边栏工作区导航
 */
function renderWorkspaceNav() {
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;

  // 获取各工作区的会议数量
  const visibleMeetings = (uiData.meetings || []).filter((meeting) => !meeting.deleted && (!meeting.isExample || meeting.exampleLocale === locale));
  const publicCount = visibleMeetings.filter((meeting) => !meeting.workspaceId).length;

  // 构建工作区子项 HTML
  const workspaceSubItems = [
    `<button class="workspace-item ${activeWorkspaceId === '' ? 'active' : ''}" data-workspace-id="">
      <span class="workspace-label">${t('公开工作区')}</span>
      <span class="workspace-count">${publicCount}</span>
    </button>`,
    ...workspaces.map(workspace => {
      const count = visibleMeetings.filter((meeting) => meeting.workspaceId === workspace.id).length;
      return `<button class="workspace-item ${activeWorkspaceId === workspace.id ? 'active' : ''}"
                data-workspace-id="${escapeHtml(workspace.id)}"
                data-workspace-name="${escapeHtml(workspace.name)}">
        <span class="workspace-label">${escapeHtml(workspace.name)}</span>
        <span class="workspace-count">${count}</span>
      </button>`;
    }).join('')
  ].join('');

  // 查找"所有会议"导航项
  const allMeetingsNav = nav.querySelector('#all-meetings');
  if (!allMeetingsNav) return;

  // 查找或创建工作区容器
  let workspaceContainer = nav.querySelector('.workspace-subnav');
  if (!workspaceContainer) {
    workspaceContainer = document.createElement('div');
    workspaceContainer.className = 'workspace-subnav';
    // 插入到"所有会议"之后，"最近删除"之前
    const recentlyDeleted = nav.querySelector('#recently-deleted');
    if (recentlyDeleted) {
      nav.insertBefore(workspaceContainer, recentlyDeleted);
    } else {
      allMeetingsNav.parentNode.insertBefore(workspaceContainer, allMeetingsNav.nextSibling);
    }
  }
  workspaceContainer.id = 'workspace-subnav';
  allMeetingsNav.setAttribute('aria-controls', workspaceContainer.id);

  workspaceContainer.innerHTML = `
    <div class="workspace-subnav-content">
      ${workspaceSubItems}
      <button class="new-workspace" data-new-workspace>
        <span>+</span> ${t('新建工作区')}
      </button>
    </div>
  `;

}

/**
 * 切换活跃工作区
 * @param {string} workspaceId - 工作区 ID
 */
async function switchWorkspace(workspaceId) {
  if (workspaceId === activeWorkspaceId && activeLibraryNav === 'all-meetings' && activeView === 'home') return;
  if (activeView === 'live' && meetingActive) minimizeMeeting();
  const applyWorkspace = async () => {
    activeWorkspaceId = workspaceId;
    localStorage.setItem('brevia-active-workspace', workspaceId);
    selectLibraryNav('all-meetings');
    if (window.brevia) {
      try { await refreshBackendMeetings(false); }
      catch (error) { showToast(error.message); }
    }
    renderWorkspaceNav();
    updateHomeViewTitle();
    filterMeetings();
  };
  if (activeView !== 'home') {
    await showView('home');
    await applyWorkspace();
    return;
  }
  await transitionPage(document.querySelector('#home-view'), document.querySelector('#home-view'), applyWorkspace);
}

const clearWorkspaceDropTarget = () => document.querySelectorAll('.workspace-item.is-drop-target').forEach((item) => item.classList.remove('is-drop-target'));
document.addEventListener('dragover', (event) => {
  const target = event.target.closest('.workspace-item');
  if (!target || !event.dataTransfer.types.includes('text/plain')) return;
  event.preventDefault();
  clearWorkspaceDropTarget();
  target.classList.add('is-drop-target');
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
    await window.brevia.workspace.assign({ meeting_id: meeting.id, workspace_id: workspaceId || null });
    const previousWorkspace = workspaces.find(({ id }) => id === meeting.workspaceId);
    const nextWorkspace = workspaces.find(({ id }) => id === workspaceId);
    if (previousWorkspace) previousWorkspace.meeting_count = Math.max(0, previousWorkspace.meeting_count - 1);
    if (nextWorkspace) nextWorkspace.meeting_count += 1;
    meeting.workspaceId = workspaceId;
    meeting.workspace = workspaceId ? { name: getWorkspaceName(workspaceId) } : null;
    renderWorkspaceNav();
    renderMeetingList();
  } catch (error) {
    showToast(error.message);
  }
});

/**
 * 更新主页标题显示当前工作区
 */
function updateHomeViewTitle() {
  const eyebrow = document.querySelector('#home-eyebrow');
  const slogan = document.querySelector('#home-slogan');

  if (activeWorkspaceId === '') {
    if (eyebrow) eyebrow.textContent = t('会议库');
    if (slogan) slogan.textContent = t('每一场对话，都留有依据。');
  } else {
    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (workspace) {
      if (eyebrow) eyebrow.textContent = `${t('会议库')} · ${workspace.name}`;
      if (slogan) slogan.textContent = workspace.description || t('工作区会议');
    }
  }
}

/**
 * 显示新建工作区对话框
 */
function showNewWorkspaceDialog(assignMeetingId, onCreated) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true">
      <header class="modal-head">
        <div class="modal-title">
          <h2>${t('新建工作区')}</h2>
          <p>${t('创建一个新的工作区来组织会议')}</p>
        </div>
        <button class="modal-close" type="button" data-close-modal aria-label="${t('关闭')}">×</button>
      </header>
      <div class="modal-body">
        <form class="workspace-form" data-workspace-form>
          <label>
            ${t('工作区名称')}
            <input name="name" type="text" maxlength="30" required autofocus />
          </label>
          <label>
            ${t('描述')} <small>${t('（可选）')}</small>
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
  requestAnimationFrame(() => {
    backdrop.classList.add('modal-enter');
  });

  // 聚焦输入框
  setTimeout(() => {
    backdrop.querySelector('input[name="name"]').focus();
  }, 100);

  const closeDialog = () => closeWorkspaceDialog(backdrop);

  // 关闭按钮事件
  backdrop.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', closeDialog);
  });

  let backdropPointerDown = false;
  backdrop.addEventListener('pointerdown', (e) => { backdropPointerDown = e.target === backdrop; });
  // 仅当按下与松开都在背景上才关闭，避免拖出弹窗时误关。
  backdrop.addEventListener('click', (e) => {
    if (backdropPointerDown && e.target === backdrop) closeDialog();
    backdropPointerDown = false;
  });

  // ESC 键关闭
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // 提交表单
  backdrop.querySelector('[data-workspace-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
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
      showToast(t('工作区已创建'));
    } catch (error) {
      showToast(error.message);
    }
  });
}

/**
 * 显示工作区编辑对话框
 * @param {string} workspaceId - 工作区 ID
 */
function showEditWorkspaceDialog(workspaceId) {
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true">
      <header class="modal-head">
        <div class="modal-title">
          <h2>${t('编辑工作区')}</h2>
          <p>${escapeHtml(workspace.name)}</p>
        </div>
        <button class="modal-close" type="button" data-close-modal aria-label="${t('关闭')}">×</button>
      </header>
      <div class="modal-body">
        <form class="workspace-form" data-workspace-form>
          <label>
            ${t('工作区名称')}
            <input name="name" type="text" maxlength="30" value="${escapeHtml(workspace.name)}" required autofocus />
          </label>
          <label>
            ${t('描述')} <small>${t('（可选）')}</small>
            <textarea name="description" maxlength="100" rows="2">${escapeHtml(workspace.description)}</textarea>
          </label>
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

  // 触发进入动画
  backdrop.classList.remove('modal-leave');
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add('modal-enter');
  });

  // 聚焦输入框
  setTimeout(() => {
    backdrop.querySelector('input[name="name"]').focus();
  }, 100);

  const closeDialog = () => closeWorkspaceDialog(backdrop);

  // 关闭按钮事件
  backdrop.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', closeDialog);
  });

  let backdropPointerDown = false;
  backdrop.addEventListener('pointerdown', (e) => { backdropPointerDown = e.target === backdrop; });
  // 仅当按下与松开都在背景上才关闭，避免拖出弹窗时误关。
  backdrop.addEventListener('click', (e) => {
    if (backdropPointerDown && e.target === backdrop) closeDialog();
    backdropPointerDown = false;
  });

  // ESC 键关闭
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // 删除工作区
  backdrop.querySelector('[data-delete-workspace]').addEventListener('click', async () => {
    openConfirmation(t('删除工作区'), t('工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。'), async () => {
      try {
        await window.brevia.workspace.delete({ workspace_id: workspaceId });
        workspaces = workspaces.filter(w => w.id !== workspaceId);
        if (activeWorkspaceId === workspaceId) void switchWorkspace('');
        uiData.meetings = uiData.meetings.filter((meeting) => meeting.workspaceId !== workspaceId);
        renderWorkspaceNav();
        renderMeetingList();
        closeDialog();
        document.removeEventListener('keydown', escHandler);
        showToast(t('工作区已删除'));
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  // 提交表单
  backdrop.querySelector('[data-workspace-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const updates = {
      name: formData.get('name').trim(),
      description: formData.get('description').trim(),
    };

    try {
      const updated = await window.brevia.workspace.update({ workspace_id: workspaceId, updates });
      const index = workspaces.findIndex(w => w.id === workspaceId);
      if (index >= 0) workspaces[index] = updated;
      renderWorkspaceNav();
      updateHomeViewTitle();
      closeDialog();
      document.removeEventListener('keydown', escHandler);
      showToast(t('工作区已更新'));
    } catch (error) {
      showToast(error.message);
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
  menu.innerHTML = `
    <div class="menu-section">
      ${[
        { id: '', name: t('公开工作区') },
        ...workspaces
      ].map(workspace => `
        <button type="button"
                data-assign-workspace="${escapeHtml(workspace.id)}"
                data-meeting-index="${meetingIndex}"
                class="menu-item ${meeting.workspaceId === workspace.id ? 'active' : ''}">
          <span class="workspace-icon">${workspace.id ? '◆' : '⊕'}</span>
          <span>${escapeHtml(workspace.name)}</span>
          ${meeting.workspaceId === workspace.id ? `<span class="check">${checkIconSvg}</span>` : ''}
        </button>
      `).join('')}
    </div>
    <div class="menu-separator"></div>
    <button type="button" data-new-workspace-assign data-meeting-index="${meetingIndex}" class="menu-item">
      <span>+</span> ${t('新建工作区')}
    </button>
  `;

  // 定位菜单
  menu.style.position = 'fixed';
  menu.style.top = `${anchorRect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - anchorRect.right}px`;

  document.body.appendChild(menu);

  // 点击外部关闭
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);

  return menu;
}

/**
 * 分配会议到工作区
 * @param {string} meetingId - 会议 ID
 * @param {string} workspaceId - 工作区 ID
 */
async function assignMeetingToWorkspace(meetingId, workspaceId) {
  try {
    await window.brevia.workspace.assign({ meeting_id: meetingId, workspace_id: workspaceId || null });

    // 更新本地数据
    const meeting = uiData.meetings.find(m => m.id === meetingId);
    if (meeting) {
      meeting.workspaceId = workspaceId;
      meeting.workspace = workspaceId ? {
        name: getWorkspaceName(workspaceId)
      } : null;
    }

    renderWorkspaceNav();
    renderMeetingList();
    showToast(t('已移至') + ' ' + getWorkspaceName(workspaceId));
  } catch (error) {
    showToast(error.message);
  }
}
