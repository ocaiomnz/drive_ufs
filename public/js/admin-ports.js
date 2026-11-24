(function () {
  const form = document.getElementById('port-form');
  const errEl = document.getElementById('port-error');
  if (!form) return;

  const EXAMPLES = {
    gdrive: '{\n  "clientId": "xxx.apps.googleusercontent.com",\n  "clientSecret": "GOCSPX-...",\n  "refreshToken": "1//...",\n  "folderId": ""\n}',
    dropbox: '{\n  "accessToken": "sl.u...",\n  "folderPath": "/UFS Drive"\n}',
    s3: '{\n  "accessKeyId": "...",\n  "secretAccessKey": "...",\n  "bucket": "meu-bucket",\n  "endpoint": "https://....r2.cloudflarestorage.com",\n  "region": "auto",\n  "prefix": "ufs-mirror"\n}',
    webhook: '{\n  "url": "https://exemplo.com/upload",\n  "fieldName": "file"\n}',
  };

  const provider = document.getElementById('port-provider');
  const config = document.getElementById('port-config');
  if (provider && config && !config.value.trim()) {
    config.placeholder = EXAMPLES[provider.value] || EXAMPLES.gdrive;
    provider.addEventListener('change', () => {
      if (!config.value.trim()) config.placeholder = EXAMPLES[provider.value] || '';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    let parsed;
    try {
      parsed = JSON.parse(config.value || '{}');
    } catch (_) {
      errEl.textContent = 'JSON inválido na configuração';
      return;
    }
    try {
      const res = await fetch('/api/ports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('port-name').value.trim(),
          provider: provider.value,
          enabled: true,
          config: parsed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao salvar');
      location.reload();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.querySelectorAll('[data-test]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await fetch(`/api/ports/${btn.dataset.test}/test`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        alert(res.ok ? `OK: ${data.user || data.note || 'conectado'}` : (data.error || 'Falha'));
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const enabled = btn.dataset.enabled !== '1';
      const res = await fetch(`/api/ports/${btn.dataset.toggle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) location.reload();
      else alert('Não foi possível alterar');
    });
  });

  document.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remover esta porta?')) return;
      const res = await fetch(`/api/ports/${btn.dataset.del}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) location.reload();
      else alert('Não foi possível remover');
    });
  });
})();
