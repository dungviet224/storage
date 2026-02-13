/**
 * API Client for Media Storage Server
 */
const API = {
    base: '/api',

    async request(path, options = {}) {
        const url = `${this.base}${path}`;
        try {
            const res = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers
                }
            });

            if (!res.ok) {
                if (res.status === 401) {
                    // Auth failed - redirect to login
                    window.location.href = '/login.html';
                    return;
                }
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            return await res.json();
        } catch (err) {
            if (err.message === 'Failed to fetch') {
                throw new Error('Không thể kết nối server');
            }
            throw err;
        }
    },

    // Stats
    getStats() {
        return this.request('/stats');
    },

    // Media list
    listMedia(params = {}) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null && v !== '') qs.set(k, v);
        }
        return this.request(`/media?${qs.toString()}`);
    },

    // Single media
    getMedia(id) {
        return this.request(`/media/${id}`);
    },

    // Update media
    updateMedia(id, data) {
        return this.request(`/media/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    },

    // Delete single
    deleteMedia(id) {
        return this.request(`/media/${id}`, { method: 'DELETE' });
    },

    // Upload files
    async uploadFiles(files, onProgress) {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file);
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${this.base}/upload`);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    try {
                        const err = JSON.parse(xhr.responseText);
                        reject(new Error(err.error));
                    } catch {
                        reject(new Error(`Upload failed: ${xhr.status}`));
                    }
                }
            };

            xhr.onerror = () => reject(new Error('Upload failed'));
            xhr.send(formData);
        });
    },

    // Batch delete
    batchDelete(ids) {
        return this.request('/media/batch-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
    },

    // Batch links
    batchLinks(ids) {
        return this.request('/media/batch-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
    },

    // Get URLs
    fileUrl(id) { return `${this.base}/media/${id}/file`; },
    thumbnailUrl(id) { return `${this.base}/media/${id}/thumbnail`; },
    playerUrl(id) { return `/watch.html?v=${id}`; },

    logout() {
        document.cookie = 'admin_token=;path=/;max-age=0';
        window.location.href = '/login.html';
    }
};
