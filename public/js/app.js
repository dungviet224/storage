/**
 * Media Storage Dashboard - SPA Application
 */

// ========== STATE ==========
let currentPage = 'dashboard';
let mediaItems = [];
let selectedIds = new Set();
let currentPagination = { page: 1, total: 0, totalPages: 0, limit: 30 };
let currentFilters = { type: 'all', search: '', sort: 'created_at', order: 'DESC' };
let isUploading = false;

// ========== NAVIGATION ==========
function navigateTo(page) {
  currentPage = page;
  selectedIds.clear();
  updateBatchBar();

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  // Reset pagination
  currentPagination.page = 1;

  renderPage();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ========== RENDER PAGES ==========
function renderPage() {
  const main = document.getElementById('main-content');

  switch (currentPage) {
    case 'dashboard': renderDashboard(main); break;
    case 'videos': currentFilters.type = 'video'; renderMediaList(main, 'Videos', '🎬'); break;
    case 'images': currentFilters.type = 'image'; renderMediaList(main, 'Images', '🖼️'); break;
    case 'all': currentFilters.type = 'all'; renderMediaList(main, 'All Media', '📁'); break;
    case 'upload': renderUpload(main); break;
    default: renderDashboard(main);
  }
}

// ========== DASHBOARD ==========
async function renderDashboard(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2><span class="icon">📊</span> Dashboard</h2>
      <button class="btn btn-primary" onclick="navigateTo('upload')">⬆️ Upload Files</button>
    </div>
    <div class="stat-grid" id="stats-grid">
      <div class="stat-card purple skeleton" style="height: 120px"></div>
      <div class="stat-card blue skeleton" style="height: 120px"></div>
      <div class="stat-card orange skeleton" style="height: 120px"></div>
      <div class="stat-card green skeleton" style="height: 120px"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h3>📂 Recent Uploads</h3>
        <button class="btn btn-sm" onclick="navigateTo('all')">View All →</button>
      </div>
      <div class="card-body" id="recent-uploads">
        <div class="loading-spinner"></div>
      </div>
    </div>
  `;

  try {
    const stats = await API.getStats();

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card purple">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${stats.totalFiles}</div>
        <div class="stat-label">Total Files • ${formatSize(stats.totalSize)}</div>
      </div>
      <div class="stat-card blue" style="cursor:pointer" onclick="navigateTo('videos')">
        <div class="stat-icon">🎬</div>
        <div class="stat-value">${stats.byType?.video?.count || 0}</div>
        <div class="stat-label">Videos • ${formatSize(stats.byType?.video?.size || 0)}</div>
      </div>
      <div class="stat-card orange" style="cursor:pointer" onclick="navigateTo('images')">
        <div class="stat-icon">🖼️</div>
        <div class="stat-value">${stats.byType?.image?.count || 0}</div>
        <div class="stat-label">Images • ${formatSize(stats.byType?.image?.size || 0)}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon">💾</div>
        <div class="stat-value">${formatSize(stats.diskUsage)}</div>
        <div class="stat-label">Disk Usage</div>
      </div>
    `;

    // Update sidebar storage info
    document.getElementById('storage-info').textContent = `💾 ${formatSize(stats.diskUsage)} used`;

    // Recent uploads
    if (stats.recent && stats.recent.length > 0) {
      document.getElementById('recent-uploads').innerHTML = `
        <div class="media-grid">
          ${stats.recent.map(item => renderMediaCard(item)).join('')}
        </div>
      `;
    } else {
      document.getElementById('recent-uploads').innerHTML = `
        <div class="empty-state">
          <span class="icon">📭</span>
          <h3>Chưa có file nào</h3>
          <p>Upload file đầu tiên để bắt đầu!</p>
        </div>
      `;
    }
  } catch (err) {
    toast('Lỗi tải dashboard: ' + err.message, 'error');
  }
}

// ========== MEDIA LIST ==========
async function renderMediaList(container, title, icon) {
  container.innerHTML = `
    <div class="page-header">
      <h2><span class="icon">${icon}</span> ${title}</h2>
      <button class="btn btn-primary" onclick="navigateTo('upload')">⬆️ Upload</button>
    </div>
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-wrapper">
          <span class="search-icon">🔍</span>
          <input class="input search-input" type="text" placeholder="Tìm kiếm..." 
            value="${currentFilters.search}" oninput="debounceSearch(this.value)">
        </div>
        <select class="select" onchange="changeSort(this.value)" id="sort-select">
          <option value="created_at-DESC" ${currentFilters.sort === 'created_at' && currentFilters.order === 'DESC' ? 'selected' : ''}>Mới nhất</option>
          <option value="created_at-ASC" ${currentFilters.sort === 'created_at' && currentFilters.order === 'ASC' ? 'selected' : ''}>Cũ nhất</option>
          <option value="original_name-ASC" ${currentFilters.sort === 'original_name' ? 'selected' : ''}>Tên A-Z</option>
          <option value="size-DESC" ${currentFilters.sort === 'size' ? 'selected' : ''}>Dung lượng ↓</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-sm" onclick="selectAllVisible()">☑️ Chọn tất cả</button>
        <button class="btn btn-sm" onclick="loadMedia()">🔄 Refresh</button>
      </div>
    </div>
    <div id="media-container"><div class="loading-spinner"></div></div>
    <div id="pagination-container"></div>
  `;

  await loadMedia();
}

async function loadMedia() {
  const container = document.getElementById('media-container');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:40px"><div class="loading-spinner"></div></div>';

  try {
    const result = await API.listMedia({
      type: currentFilters.type !== 'all' ? currentFilters.type : undefined,
      search: currentFilters.search || undefined,
      sort: currentFilters.sort,
      order: currentFilters.order,
      page: currentPagination.page,
      limit: currentPagination.limit
    });

    mediaItems = result.items;
    currentPagination = result.pagination;

    if (mediaItems.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="icon">📭</span>
          <h3>Không tìm thấy file nào</h3>
          <p>Thử thay đổi bộ lọc hoặc upload file mới</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="media-grid">
          ${mediaItems.map(item => renderMediaCard(item)).join('')}
        </div>
      `;
    }

    renderPagination();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Lỗi</h3><p>${err.message}</p></div>`;
    toast('Lỗi tải media: ' + err.message, 'error');
  }
}

function renderMediaCard(item) {
  const isSelected = selectedIds.has(item.id);
  const thumbUrl = API.thumbnailUrl(item.id);
  const duration = item.duration ? formatDuration(item.duration) : '';

  return `
    <div class="media-item ${isSelected ? 'selected' : ''}" data-id="${item.id}" 
         onclick="handleItemClick(event, '${item.id}')">
      <div class="thumb-container">
        <img src="${thumbUrl}" alt="${escapeHtml(item.original_name)}" loading="lazy"
             onerror="this.style.display='none'">
        <span class="type-badge ${item.type}">${item.type === 'video' ? '🎬 Video' : '🖼️ Image'}</span>
        ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
        <div class="thumb-overlay">
          <div class="play-icon">${item.type === 'video' ? '▶' : '🔍'}</div>
        </div>
        <div class="checkbox-overlay" onclick="event.stopPropagation(); toggleSelect('${item.id}')"></div>
      </div>
      <div class="item-info">
        <div class="item-name" title="${escapeHtml(item.original_name)}">${escapeHtml(item.original_name)}</div>
        <div class="item-meta">
          <span>${formatSize(item.size)}</span>
          <span>${formatDate(item.created_at)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderPagination() {
  const container = document.getElementById('pagination-container');
  if (!container || currentPagination.totalPages <= 1) {
    if (container) container.innerHTML = '';
    return;
  }

  const { page, totalPages, total } = currentPagination;
  let buttons = '';

  buttons += `<button ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">‹</button>`;

  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);

  if (start > 1) {
    buttons += `<button onclick="goToPage(1)">1</button>`;
    if (start > 2) buttons += `<span class="page-info">...</span>`;
  }

  for (let i = start; i <= end; i++) {
    buttons += `<button class="${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) buttons += `<span class="page-info">...</span>`;
    buttons += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  buttons += `<button ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">›</button>`;

  container.innerHTML = `
    <div class="pagination">
      ${buttons}
      <span class="page-info">${total} items</span>
    </div>
  `;
}

function goToPage(page) {
  currentPagination.page = page;
  loadMedia();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========== UPLOAD PAGE ==========
function renderUpload(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2><span class="icon">⬆️</span> Upload Files</h2>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="upload-zone" id="upload-zone" 
             onclick="document.getElementById('file-input').click()"
             ondragover="event.preventDefault(); this.classList.add('dragover')"
             ondragleave="this.classList.remove('dragover')"
             ondrop="handleDrop(event)">
          <span class="upload-icon">☁️</span>
          <h3>Kéo thả hoặc click để chọn file</h3>
          <p>Hỗ trợ: JPG, PNG, GIF, WebP, MP4, WebM, MKV, AVI, MOV</p>
          <p style="margin-top:8px;color:var(--text-dim)">Tối đa ${formatSize(500 * 1024 * 1024)} / file • ${20} files / lần</p>
        </div>
        <input type="file" id="file-input" hidden multiple 
               accept="image/*,video/*" onchange="handleFileSelect(this.files)">
        <div class="upload-progress-list" id="upload-progress"></div>
      </div>
    </div>
  `;
}

async function handleDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');
  const files = event.dataTransfer.files;
  if (files.length) await uploadFiles(files);
}

async function handleFileSelect(files) {
  if (files.length) await uploadFiles(files);
}

async function uploadFiles(files) {
  if (isUploading) {
    toast('Đang upload, vui lòng chờ...', 'info');
    return;
  }

  isUploading = true;
  const progressContainer = document.getElementById('upload-progress');

  // Show progress UI
  const fileNames = Array.from(files).map(f => f.name);
  progressContainer.innerHTML = fileNames.map((name, i) => `
    <div class="upload-progress-item" id="upload-item-${i}">
      <span class="status-icon">⏳</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(name)}</div>
        <div class="progress-bar"><div class="fill" id="progress-fill" style="width: 0%"></div></div>
      </div>
    </div>
  `).join('');

  try {
    const result = await API.uploadFiles(files, (percent) => {
      const fill = document.getElementById('progress-fill');
      if (fill) fill.style.width = percent + '%';
    });

    // Update all items to success
    fileNames.forEach((_, i) => {
      const item = document.getElementById(`upload-item-${i}`);
      if (item) {
        item.querySelector('.status-icon').textContent = '✅';
        item.querySelector('.progress-bar .fill').style.width = '100%';
      }
    });

    toast(`✅ Đã upload ${result.uploaded} file thành công!`, 'success');

    // Reset file input
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';

  } catch (err) {
    // Update items to error
    fileNames.forEach((_, i) => {
      const item = document.getElementById(`upload-item-${i}`);
      if (item) item.querySelector('.status-icon').textContent = '❌';
    });
    toast('❌ Upload thất bại: ' + err.message, 'error');
  }

  isUploading = false;
}

// ========== ITEM INTERACTIONS ==========
function handleItemClick(event, id) {
  // If clicking checkbox area, toggle select only
  if (event.target.closest('.checkbox-overlay')) return;

  const item = mediaItems.find(i => i.id === id);
  if (!item) {
    // Try to fetch if from recent/dashboard view
    showMediaDetailById(id);
    return;
  }

  // Always open properties modal (both video & image)
  showMediaDetail(item);
}

async function showMediaDetailById(id) {
  try {
    const item = await API.getMedia(id);
    showMediaDetail(item);
  } catch (err) {
    toast('Lỗi tải media: ' + err.message, 'error');
  }
}

function showMediaDetail(item) {
  const baseUrl = window.location.origin;
  const directUrl = `${baseUrl}${API.fileUrl(item.id)}`;
  const playerUrl = `${baseUrl}${API.playerUrl(item.id)}`;

  let content = '';

  if (item.type === 'video') {
    content = `
      <div class="video-detail">
        <div>
          <div class="video-player-wrap">
            <video controls autoplay preload="metadata" style="width:100%;max-height:400px">
              <source src="${API.fileUrl(item.id)}" type="${item.mime}">
            </video>
          </div>
        </div>
        <div class="video-info-panel">
          <div class="info-row"><span class="label">Tên file</span><span class="value">${escapeHtml(item.original_name)}</span></div>
          <div class="info-row"><span class="label">Loại</span><span class="value">${item.mime}</span></div>
          <div class="info-row"><span class="label">Dung lượng</span><span class="value">${formatSize(item.size)}</span></div>
          ${item.width ? `<div class="info-row"><span class="label">Độ phân giải</span><span class="value">${item.width}x${item.height}</span></div>` : ''}
          ${item.duration ? `<div class="info-row"><span class="label">Thời lượng</span><span class="value">${formatDuration(item.duration)}</span></div>` : ''}
          <div class="info-row"><span class="label">Ngày upload</span><span class="value">${formatDate(item.created_at)}</span></div>
          
          <div style="margin-top:8px">
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px">📎 Direct URL</div>
            <div class="link-box">
              <input value="${directUrl}" readonly id="link-direct">
              <button class="copy-btn" onclick="copyText('${directUrl}')">Copy</button>
            </div>
          </div>
          <div style="margin-top:8px">
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px">▶️ Player URL</div>
            <div class="link-box">
              <input value="${playerUrl}" readonly id="link-player">
              <button class="copy-btn" onclick="copyText('${playerUrl}')">Copy</button>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    content = `
      <div class="video-detail">
        <div>
          <div style="text-align:center;background:var(--bg-primary);border-radius:var(--radius);padding:20px">
            <img src="${API.fileUrl(item.id)}" alt="${escapeHtml(item.original_name)}" 
                 style="max-width:100%;max-height:500px;border-radius:8px">
          </div>
        </div>
        <div class="video-info-panel">
          <div class="info-row"><span class="label">Tên file</span><span class="value">${escapeHtml(item.original_name)}</span></div>
          <div class="info-row"><span class="label">Loại</span><span class="value">${item.mime}</span></div>
          <div class="info-row"><span class="label">Dung lượng</span><span class="value">${formatSize(item.size)}</span></div>
          <div class="info-row"><span class="label">Ngày upload</span><span class="value">${formatDate(item.created_at)}</span></div>
          
          <div style="margin-top:8px">
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px">📎 Direct URL</div>
            <div class="link-box">
              <input value="${directUrl}" readonly>
              <button class="copy-btn" onclick="copyText('${directUrl}')">Copy</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  openModal(escapeHtml(item.original_name), content, `
    <button class="btn" onclick="window.open('${directUrl}', '_blank')">🔗 Mở link</button>
    ${item.type === 'video' ? `<button class="btn" onclick="window.open('${playerUrl}', '_blank')">▶️ Player</button>` : ''}
    <button class="btn btn-danger" onclick="deleteItem('${item.id}')">🗑️ Xóa</button>
  `);
}

async function deleteItem(id) {
  if (!confirm('Bạn có chắc muốn xóa file này?')) return;

  try {
    await API.deleteMedia(id);
    toast('✅ Đã xóa thành công', 'success');
    closeModal();
    selectedIds.delete(id);
    updateBatchBar();

    // Refresh current view
    if (currentPage === 'dashboard') renderDashboard(document.getElementById('main-content'));
    else loadMedia();
  } catch (err) {
    toast('❌ Xóa thất bại: ' + err.message, 'error');
  }
}

// ========== SELECTION & BATCH ==========
function toggleSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }

  // Update visual
  const el = document.querySelector(`.media-item[data-id="${id}"]`);
  if (el) el.classList.toggle('selected', selectedIds.has(id));

  updateBatchBar();
}

function selectAllVisible() {
  const items = document.querySelectorAll('.media-item[data-id]');
  const allSelected = items.length > 0 && Array.from(items).every(el => selectedIds.has(el.dataset.id));

  if (allSelected) {
    items.forEach(el => {
      selectedIds.delete(el.dataset.id);
      el.classList.remove('selected');
    });
  } else {
    items.forEach(el => {
      selectedIds.add(el.dataset.id);
      el.classList.add('selected');
    });
  }

  updateBatchBar();
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll('.media-item.selected').forEach(el => el.classList.remove('selected'));
  updateBatchBar();
}

function updateBatchBar() {
  const bar = document.getElementById('batch-bar');
  const count = document.getElementById('batch-count');
  if (selectedIds.size > 0) {
    bar.classList.add('visible');
    count.textContent = `${selectedIds.size} đã chọn`;
  } else {
    bar.classList.remove('visible');
  }
}

async function batchCopyLinks() {
  if (selectedIds.size === 0) return;

  try {
    const result = await API.batchLinks(Array.from(selectedIds));
    const links = result.links.map(l => l.directUrl).join('\n');
    await navigator.clipboard.writeText(links);
    toast(`✅ Đã copy ${result.links.length} direct links!`, 'success');
  } catch (err) {
    toast('❌ Lỗi: ' + err.message, 'error');
  }
}

async function batchGenerateUrls() {
  if (selectedIds.size === 0) return;

  try {
    const result = await API.batchLinks(Array.from(selectedIds));

    let content = `
      <div style="margin-bottom:16px">
        <button class="btn btn-sm" onclick="copyAllLinks('direct')">📋 Copy All Direct URLs</button>
        <button class="btn btn-sm" onclick="copyAllLinks('player')" style="margin-left:8px">📋 Copy All Player URLs</button>
      </div>
      <div class="links-list" id="generated-links">
        ${result.links.map(link => `
          <div class="link-item">
            <div class="link-name">${link.type === 'video' ? '🎬' : '🖼️'} ${escapeHtml(link.name)}</div>
            <div class="link-urls">
              <div class="link-url-row">
                <span class="label">Direct:</span>
                <code>${link.directUrl}</code>
                <button class="copy-btn" onclick="copyText('${link.directUrl}')">Copy</button>
              </div>
              ${link.type === 'video' ? `
              <div class="link-url-row">
                <span class="label">Player:</span>
                <code>${link.playerUrl}</code>
                <button class="copy-btn" onclick="copyText('${link.playerUrl}')">Copy</button>
              </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:16px">
        <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px">📝 Tất cả URLs (plain text)</div>
        <textarea class="batch-links-area" id="all-links-text" readonly>${result.links.map(l => l.directUrl).join('\n')}</textarea>
      </div>
    `;

    // Store links data for copy functions
    window._batchLinksData = result.links;

    openModal(`🔗 Generated URLs (${result.links.length} files)`, content, '');
  } catch (err) {
    toast('❌ Lỗi: ' + err.message, 'error');
  }
}

function copyAllLinks(type) {
  if (!window._batchLinksData) return;
  const links = window._batchLinksData.map(l => type === 'player' ? (l.playerUrl || l.directUrl) : l.directUrl);
  navigator.clipboard.writeText(links.join('\n')).then(() => {
    toast(`✅ Đã copy ${links.length} ${type} URLs!`, 'success');
  });
}

async function batchDeleteSelected() {
  if (selectedIds.size === 0) return;
  if (!confirm(`Bạn có chắc muốn xóa ${selectedIds.size} file?`)) return;

  try {
    const result = await API.batchDelete(Array.from(selectedIds));
    toast(`✅ Đã xóa ${result.deleted} file!`, 'success');
    selectedIds.clear();
    updateBatchBar();
    loadMedia();
  } catch (err) {
    toast('❌ Xóa thất bại: ' + err.message, 'error');
  }
}

// ========== SEARCH & SORT ==========
let searchTimeout = null;
function debounceSearch(value) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentFilters.search = value;
    currentPagination.page = 1;
    loadMedia();
  }, 400);
}

function changeSort(value) {
  const [sort, order] = value.split('-');
  currentFilters.sort = sort;
  currentFilters.order = order || 'DESC';
  currentPagination.page = 1;
  loadMedia();
}

// ========== MODAL ==========
function openModal(title, body, footer) {
  document.getElementById('modal-title').textContent = '';
  document.getElementById('modal-title').innerHTML = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer || '';
  document.getElementById('modal-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('modal-overlay').classList.remove('active');
  document.body.style.overflow = '';

  // Stop any playing video
  const videos = document.querySelectorAll('.modal video');
  videos.forEach(v => { v.pause(); v.src = ''; });
}

// ========== TOAST ==========
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ========== UTILITIES ==========
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDuration(seconds) {
  if (!seconds) return '';
  seconds = Math.round(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút trước`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} giờ trước`;
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)} ngày trước`;

  return d.toLocaleDateString('vi-VN');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('✅ Đã copy!', 'success');
  } catch {
    // Fallback
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    toast('✅ Đã copy!', 'success');
  }
}

// ========== KEYBOARD SHORTCUTS ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.ctrlKey && e.key === 'a' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    selectAllVisible();
  }
});

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('dashboard');
});
