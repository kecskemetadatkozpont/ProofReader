/* Publify — shared Microsoft Office extractor. window.PROffice.extract(file) → Promise<{text, ext}>.
 * Word (.docx) → markdown (mammoth), Excel (.xlsx/.xls) → CSV-per-sheet (SheetJS), PowerPoint (.pptx) →
 * slide text (JSZip). Heavy libraries are lazy-loaded from CDN on first use, so this file stays tiny and only
 * pays the cost when an Office file is actually processed. Wire it into every upload surface as a pre-step. */
(function () {
  'use strict';
  if (window.PROffice) return;

  var _p = {};
  function loadScript(src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
    if (_p[src]) return _p[src];
    _p[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { resolve(globalName ? window[globalName] : true); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
    return _p[src];
  }
  function readArrayBuffer(file) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); });
  }

  function extractDocx(file) {
    return loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js', 'mammoth').then(function (m) {
      return readArrayBuffer(file).then(function (ab) {
        return m.convertToMarkdown({ arrayBuffer: ab }).then(function (r) { return { text: (r && r.value) || '', ext: 'md' }; });
      });
    });
  }
  function extractXlsx(file) {
    return loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX').then(function (X) {
      return readArrayBuffer(file).then(function (ab) {
        var wb = X.read(ab, { type: 'array' });
        var parts = (wb.SheetNames || []).map(function (n) {
          var csv = X.utils.sheet_to_csv(wb.Sheets[n]);
          return (wb.SheetNames.length > 1 ? ('## ' + n + '\n') : '') + csv;
        });
        return { text: parts.join('\n\n').trim(), ext: 'csv' };
      });
    });
  }
  function extractPptx(file) {
    return loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip').then(function (JSZip) {
      return readArrayBuffer(file).then(function (ab) {
        return JSZip.loadAsync(ab).then(function (zip) {
          var names = Object.keys(zip.files).filter(function (n) { return /ppt\/slides\/slide\d+\.xml$/.test(n); })
            .sort(function (a, b) { return (parseInt((a.match(/slide(\d+)/) || [])[1], 10) || 0) - (parseInt((b.match(/slide(\d+)/) || [])[1], 10) || 0); });
          return Promise.all(names.map(function (n) { return zip.files[n].async('string'); })).then(function (xmls) {
            var out = xmls.map(function (xml, i) {
              var texts = [], re = /<a:t>([^<]*)<\/a:t>/g, mt;
              while ((mt = re.exec(xml))) { if (mt[1]) texts.push(mt[1]); }
              return '## Slide ' + (i + 1) + '\n\n' + texts.join('\n');
            }).join('\n\n');
            return { text: out.trim(), ext: 'md' };
          });
        });
      });
    });
  }

  window.PROffice = {
    isOffice: function (name) { return /\.(docx|xlsx|xlsm|xls|pptx)$/i.test(String(name || '')); },
    // extract(file) → Promise<{ text:String, ext:'md'|'csv' }>; rejects for non-Office files / parse errors
    extract: function (file) {
      var n = String((file && file.name) || '').toLowerCase();
      if (/\.docx$/.test(n)) return extractDocx(file);
      if (/\.(xlsx|xlsm|xls)$/.test(n)) return extractXlsx(file);
      if (/\.pptx$/.test(n)) return extractPptx(file);
      return Promise.reject(new Error('not a supported Office file'));
    }
  };
})();
