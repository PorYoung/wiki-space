/* ewiki 知识库插件 UI 逻辑：连接配置 / 检索 / 浏览，全部经桥 invoke（iframe 不持令牌） */
(function () {
  'use strict';

  var edith = window.EdithPlugin;
  if (!edith) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<p style="color:#f87171">桥 SDK 未加载（/api/v1/plugins/bridge-client.js）</p>'
    );
    return;
  }

  var $ = function (id) { return document.getElementById(id); };

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function print(id, obj) {
    var el = $(id);
    if (obj == null) { el.textContent = ''; hide(el); return; }
    el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    show(el);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  /** snippet 里的 <em> 命中标记保留，其余转义 */
  function richSnippet(s) {
    var safe = esc(s).replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>');
    return safe;
  }
  function invoke(path, body) {
    return edith.invoke({ path: path, body: body });
  }

  // ── Tab 切换 ──
  var tabs = [['tab-conn', 'panel-conn'], ['tab-search', 'panel-search'], ['tab-browse', 'panel-browse']];
  tabs.forEach(function (pair) {
    $(pair[0]).addEventListener('click', function () {
      tabs.forEach(function (p) {
        $(p[0]).classList.toggle('active', p[0] === pair[0]);
        $(p[1]).classList.toggle('hidden', p[1] !== pair[1]);
      });
    });
  });

  // ── 连接 ──
  function renderBadge(conn) {
    var b = $('conn-badge');
    if (conn && conn.configured) {
      b.textContent = '已连接 ' + (conn.baseUrl || '');
      b.className = 'badge on';
    } else {
      b.textContent = '未连接';
      b.className = 'badge off';
    }
  }

  function refreshConnection() {
    invoke('/connection').then(function (res) {
      renderBadge(res);
      if (res && res.configured) $('in-baseurl').value = res.baseUrl || '';
    }).catch(function (err) {
      print('conn-out', 'ERROR ' + (err.code || '') + ': ' + err.message);
    });
  }

  $('btn-save').addEventListener('click', function () {
    var body = { baseUrl: $('in-baseurl').value.trim() };
    var token = $('in-token').value.trim();
    if (token) body.token = token;
    print('conn-out', '保存中…');
    invoke('/connection.save', body).then(function (res) {
      if (res && res.ok) {
        $('in-token').value = '';
        print('conn-out', '已保存：' + res.baseUrl + '（令牌 ' + res.patPrefix + '…，已入平台密钥托管）');
        refreshConnection();
      } else {
        print('conn-out', (res && res.message) || '保存失败');
      }
    }).catch(function (err) { print('conn-out', 'ERROR ' + (err.code || '') + ': ' + err.message); });
  });

  $('btn-test').addEventListener('click', function () {
    print('conn-out', '测试中…');
    invoke('/connection.test').then(function (res) { print('conn-out', res); })
      .catch(function (err) { print('conn-out', 'ERROR ' + (err.code || '') + ': ' + err.message); });
  });

  $('btn-unlink').addEventListener('click', function () {
    invoke('/connection.delete').then(function () {
      $('in-baseurl').value = '';
      $('in-token').value = '';
      print('conn-out', null);
      renderBadge(null);
    });
  });

  // ── 检索 ──
  function renderResults(items) {
    var box = $('search-results');
    box.innerHTML = '';
    if (!items || !items.length) {
      box.innerHTML = '<p class="loading">无命中</p>';
      return;
    }
    items.forEach(function (it) {
      var div = document.createElement('div');
      div.className = 'item';
      div.innerHTML =
        '<span class="score">' + esc(it.score != null ? it.score.toFixed(3) : '') + '</span>' +
        '<div class="t">' + esc(it.title || it.path) + '</div>' +
        '<div class="m">' + esc((it.projectName || '') + ' / ' + (it.path || '') + (it.heading ? ' · ' + it.heading : '')) + '</div>' +
        (it.snippet ? '<div class="snippet">' + richSnippet(it.snippet) + '</div>' : '');
      div.addEventListener('click', function () { openDocument(it.documentId, div); });
      box.appendChild(div);
    });
  }

  function openDocument(documentId, itemEl) {
    var view = $('doc-view');
    print('doc-view', '加载全文…');
    show(view);
    invoke('/kb/document', { documentId: documentId }).then(function (res) {
      if (res && res.ok !== false) {
        var head = [res.title || '', res.path || '', '版本 v' + (res.latestVersionNo != null ? res.latestVersionNo : '?') + ' · 更新 ' + (res.updatedAt || '')].join('\n');
        print('doc-view', head + '\n\n' + (res.content || '（无正文）'));
        if (itemEl) { itemEl.style.borderColor = 'var(--accent)'; }
      } else {
        print('doc-view', (res && res.message) || '读取失败');
      }
    }).catch(function (err) { print('doc-view', 'ERROR ' + (err.code || '') + ': ' + err.message); });
  }

  function doSearch() {
    var q = $('in-q').value.trim();
    if (!q) return;
    $('search-results').innerHTML = '<p class="loading">检索中…</p>';
    hide($('doc-view'));
    invoke('/kb/search', { q: q, limit: 10 }).then(function (res) {
      if (res && res.ok !== false) {
        renderResults(res.items || []);
        if (res.degraded) print('doc-view', '提示：知识库未开启向量检索，已自动降级为全文检索（degraded）。');
        else print('doc-view', null);
      } else {
        $('search-results').innerHTML = '';
        print('doc-view', (res && res.message) || '检索失败');
      }
    }).catch(function (err) {
      $('search-results').innerHTML = '';
      print('doc-view', 'ERROR ' + (err.code || '') + ': ' + err.message);
    });
  }
  $('btn-search').addEventListener('click', doSearch);
  $('in-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

  // ── 浏览 ──
  function renderProjects(items) {
    var box = $('project-list');
    box.innerHTML = '';
    (items || []).forEach(function (p) {
      var div = document.createElement('div');
      div.className = 'item';
      div.innerHTML =
        '<div class="t">' + esc(p.name) + '</div>' +
        '<div class="m">' + esc((p.visibility || '') + (p.ownerType ? ' · ' + p.ownerType : '') + (p.updatedAt ? ' · 更新 ' + p.updatedAt : '')) + '</div>';
      div.addEventListener('click', function () { loadDocuments(p.id, p.name); });
      box.appendChild(div);
    });
  }

  function loadDocuments(projectId, projectName) {
    $('doc-list').innerHTML = '<p class="loading">加载 ' + esc(projectName || projectId) + ' 的文档…</p>';
    invoke('/kb/documents', { projectId: projectId }).then(function (res) {
      var box = $('doc-list');
      box.innerHTML = '';
      var items = (res && res.items) || [];
      if (!items.length) { box.innerHTML = '<p class="loading">该库暂无文档</p>'; return; }
      items.forEach(function (d) {
        var div = document.createElement('div');
        div.className = 'item';
        div.innerHTML =
          '<div class="t">' + esc(d.title || d.path) + '</div>' +
          '<div class="m">' + esc((d.path || '') + (d.updatedAt ? ' · 更新 ' + d.updatedAt : '')) + '</div>';
        div.addEventListener('click', function () {
          show($('panel-search'));
          tabs.forEach(function (p) { $(p[0]).classList.toggle('active', p[0] === 'tab-search'); });
          openDocument(d.id || d.documentId, null);
        });
        box.appendChild(div);
      });
    }).catch(function (err) {
      $('doc-list').innerHTML = '<p class="loading">ERROR ' + esc(err.code || '') + ': ' + esc(err.message) + '</p>';
    });
  }

  $('btn-projects').addEventListener('click', function () {
    $('project-list').innerHTML = '<p class="loading">加载中…</p>';
    $('doc-list').innerHTML = '';
    invoke('/kb/projects').then(function (res) {
      renderProjects((res && res.items) || []);
    }).catch(function (err) {
      $('project-list').innerHTML = '<p class="loading">ERROR ' + esc(err.code || '') + ': ' + esc(err.message) + '</p>';
    });
  });

  refreshConnection();
})();
