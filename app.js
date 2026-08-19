/* app.js — Blabla Korea 예약 시스템
   app.html 의 <script> 내용을 그대로 옮긴 것. 바뀐 곳은 네 군데다:
     1) BOOT 를 서버 렌더링 대신 boot 액션 fetch 로 받는다 (+ build 태그 캐시)
     2) App.call 을 google.script.run → fetch 로 (봉투 → Error 되살리기)
     3) DOMContentLoaded 를 가로채 boot 도착 뒤에 화면 초기화를 부른다
     4) BOOT 에 의존하던 초기값을 App 생성 시점 → init() 으로 옮겼다
   나머지(esc · safeHttpsUrl · 저장소 · 언어 · 시간대 · toast)는 손대지 않았다.
   API_URL 은 config.js 에 있다. */

  // ---- BOOT payload ----
  // 예전에는 Main.gs 의 renderPage_ 가 BOOT 를 HTML 안에 심어줘서, 화면 코드가 도는 시점에
  // 이미 값이 있었다. 정적 사이트에는 서버 렌더링이 없다 → boot 액션으로 받아온다.
  var BOOT = {};

  // ---- 서버 호출 (fetch) ----
  // 요청은 언제나 POST /exec { action, args:[...] } 한 가지 모양이다. args 는 위치 배열이라
  // .gs 함수 시그니처를 그대로 쓴다.
  //
  // Content-Type 이 text/plain 인 이유: application/json 은 CORS preflight(OPTIONS)를 부르는데
  // Apps Script 는 OPTIONS 를 처리하지 못한다. text/plain 은 단순 요청이라 preflight 가 없다.
  //
  // 응답은 항상 HTTP 200 + { ok, build, data | code, message } 봉투다.
  // 화면의 .catch() 들은 err.message 안의 토큰으로 문구를 고른다
  // (index.html errToMsg: 'AUTH_REQUIRED' · 'SLOT_TAKEN' · 'BOOK_TOO_LATE' …).
  // → 서버가 실어 보낸 message 를 그대로 Error 로 되살린다. 화면 코드는 한 줄도 고치지 않는다.
  function apiCall(action, args) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, args: args || [] })
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var env = null;
      try { env = JSON.parse(text); } catch (e) { throw new Error('SERVER_ERROR'); }
      if (env && env.ok) return env.data;
      throw new Error((env && (env.message || env.code)) || 'SERVER_ERROR');
    });
  }

  // ---- boot 캐시 ----
  // 첫 호출이 1.5초쯤 걸린다(콜드 스타트 + 302 경유). i18n 문구표는 15KB 이고 잘 바뀌지 않으므로
  // build 태그를 키에 넣어 저장해 두고, 다음 방문부터는 캐시로 즉시 화면을 띄운다.
  // 그러고 나서 뒤에서 조용히 다시 받아 build 가 다르면 옛 캐시를 버린다.
  var BOOT_PTR = 'bbk_boot_build';
  function bootCacheGet() {
    try {
      var b = localStorage.getItem(BOOT_PTR);
      if (!b) return null;
      var raw = localStorage.getItem('bbk_boot_' + b);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function bootCachePut(p) {
    try {
      var prev = localStorage.getItem(BOOT_PTR);
      if (prev && prev !== p.build) localStorage.removeItem('bbk_boot_' + prev);
      localStorage.setItem('bbk_boot_' + p.build, JSON.stringify(p));
      localStorage.setItem(BOOT_PTR, p.build);
    } catch (e) {}
  }

  var bootPromise = null;
  function loadBoot() {
    if (bootPromise) return bootPromise;
    var cached = bootCacheGet();
    var live = apiCall('boot', []).then(function (p) {
      if (!p || !p.i18n) return null;
      if (!cached) bootCachePut(p);
      else if (cached.build !== p.build) {
        console.warn('build 불일치 — 캐시 ' + cached.build + ' / 서버 ' + p.build + ' → 캐시 폐기');
        bootCachePut(p);
      }
      return p;
    }).catch(function (e) { console.error('boot 실패: ' + e); return null; });

    // 캐시가 있으면 기다리지 않는다. 위 live 는 뒤에서 캐시만 갱신한다(다음 방문에 반영).
    if (cached) { BOOT = cached; bootPromise = Promise.resolve(true); }
    else bootPromise = live.then(function (p) { if (p) BOOT = p; return !!p; });
    return bootPromise;
  }

  // ---- DOMContentLoaded 다리 ----
  // index.html 의 초기화는 DOMContentLoaded 에 걸려 있는데, 그 시점엔 boot 가 아직 안 왔다.
  // 화면 코드를 고치는 대신 등록을 가로채서 "DOM 준비 + boot 도착" 양쪽이 끝난 뒤에 부른다.
  var _addEL = document.addEventListener.bind(document);
  function domReady() {
    return new Promise(function (resolve) {
      if (document.readyState !== 'loading') resolve();
      else _addEL('DOMContentLoaded', function () { resolve(); });
    });
  }
  document.addEventListener = function (type, fn, opts) {
    if (type === 'DOMContentLoaded' && typeof fn === 'function') {
      Promise.all([loadBoot(), domReady()]).then(function (r) {
        if (r[0]) fn();
        else showBootFailure();
      });
      return;
    }
    return _addEL(type, fn, opts);
  };

  // boot 가 실패하고 캐시도 없으면 i18n 이 없다 → 화면을 그대로 띄우면 문구 자리에
  // 키 이름('login_title')이 그대로 보인다. 그것보다는 짧은 안내가 낫다.
  function showBootFailure() {
    document.body.innerHTML =
      '<div style="max-width:420px;margin:16vh auto;padding:24px;text-align:center;' +
      'font:16px/1.7 system-ui,-apple-system,sans-serif">' +
      '<p>연결에 실패했습니다.<br>Connexion impossible.<br>Connection failed.</p>' +
      '<button id="bbkRetry" style="font:inherit;padding:10px 18px;margin-top:12px;' +
      'border-radius:8px;border:1px solid #888;background:#f5f5f5;cursor:pointer">' +
      '다시 시도 · Réessayer</button></div>';
    document.getElementById('bbkRetry').addEventListener('click', function () { location.reload(); });
  }

  // Session persistence uses two layers so the 90-day auto-login (§7) survives both
  // in-tab navigation AND closing/reopening the tab:
  //   - window.name: survives same-tab navigation (index ⇄ mypage) and works even when
  //     a 3rd-party iframe blocks storage; but is lost when the tab closes.
  //   - localStorage: durable across visits/days, so a returning student stays logged in.
  //     (In a 3rd-party iframe it's partitioned per top-level site — fine for blablakorea.fr;
  //     if a strict browser blocks it, we degrade gracefully to window.name only.)
  // Neither exposes the token in the URL.
  /**
   * HTML 이스케이프 — innerHTML 로 값을 넣기 전에 **반드시** 통과시킨다.
   *
   * 왜 필요한가 (2026-08 보안 수정 2단계):
   * 학생이 체험 폼에 넣은 이름·전화번호가 강사의 관리자 화면에 그대로 innerHTML 로
   * 들어가고 있었다. 이름에 <img src=x onerror=...> 를 넣으면 강사가 예약 관리 탭을
   * 여는 순간 그 코드가 강사 브라우저에서 실행되고, 같은 오리진의 localStorage 에 있는
   * **강사 세션 토큰**을 그대로 가져갈 수 있었다.
   *
   * 규칙: innerHTML 로 만드는 문자열 안에 들어가는 값은 리터럴이 아니면 전부 esc().
   *       속성값(<option value="...">, href="...")도 같다 — 따옴표를 이스케이프하지
   *       않으면 속성을 닫고 빠져나갈 수 있다.
   * 값을 통째로 넣기만 하면 될 때는 innerHTML 대신 textContent 를 쓰는 편이 더 낫다.
   */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * href 에 넣어도 되는 주소만 통과시킨다 — **https:// 만** 허용.
   *
   * Meet 링크는 Calendar API 가 만들지만, 값은 Bookings 시트를 거쳐 돌아온다.
   * 시트를 손으로 고치거나 잘못 이관하면 임의 문자열이 들어올 수 있고,
   * href 에 javascript: 가 들어가면 클릭 한 번으로 그 페이지 권한에서 코드가 돈다.
   * esc() 는 따옴표만 막을 뿐 스킴은 막지 못하므로 둘 다 필요하다.
   *
   * 통과하지 못하면 빈 문자열을 돌려준다 → 호출부는 링크를 아예 그리지 않는다.
   * (http:// 도 막는다. Google Meet 는 항상 https 다.)
   */
  function safeHttpsUrl(v) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
  }

  var LS_KEY = 'bbk_store';
  function lsGet() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function lsSet(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function readStore() {
    var ls = lsGet(), wn;
    try { wn = JSON.parse(window.name || '{}') || {}; } catch (e) { wn = {}; }
    // localStorage = durable base; window.name overlays the freshest same-session values.
    var merged = {};
    Object.keys(ls).forEach(function (k) { merged[k] = ls[k]; });
    Object.keys(wn).forEach(function (k) { merged[k] = wn[k]; });
    return merged;
  }
  function writeStore(patch) {
    var s = readStore();
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    try { window.name = JSON.stringify(s); } catch (e) {}
    lsSet(s);
  }

  var App = (function () {
    // BOOT 은 fetch 로 오므로 이 시점엔 비어 있다. 값 주입은 init() 에서 한다
    // (init() 은 boot 가 도착한 뒤에 불린다 — 위 DOMContentLoaded 다리 참조).
    var state = {
      session: null,
      lang: null,
      tz: null,
      i18n: {},
      defaultLang: 'fr'
    };

    // ---- language (§11): stored → browser → ko/en/fr else default ----
    function detectLang() {
      var s = readStore();
      if (s.lang && state.i18n[s.lang]) return s.lang;
      var nav = (navigator.language || 'fr').slice(0, 2).toLowerCase();
      if (state.i18n[nav]) return nav;
      return state.defaultLang;
    }
    function setLang(l) {
      if (!state.i18n[l]) return;
      state.lang = l;
      writeStore({ lang: l });
      if (typeof onLangChange === 'function') onLangChange(l);
    }
    function t(key, vars) {
      var s = (state.i18n[state.lang] && state.i18n[state.lang][key]) || key;
      if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{{' + k + '}}', vars[k]); });
      return s;
    }

    // ---- timezone (§4.4) ----
    function detectTz() {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'; }
      catch (e) { return 'Europe/Paris'; }
    }

    // ---- session ----
    function setSession(s) { state.session = s; writeStore({ session: s }); }
    function getSession() { return state.session; }
    function isLoggedIn() { return !!state.session; }
    function logout() { state.session = null; writeStore({ session: null }); }

    // ---- 서버 호출 ----
    // 호출부(index.html)는 App.call('bookPrivate', sess, iso, opts) 그대로다.
    function call(fn) {
      return apiCall(fn, Array.prototype.slice.call(arguments, 1));
    }

    // ---- UI helpers ----
    function toast(msg, isWarn) {
      var el = document.getElementById('toast');
      if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
      el.textContent = msg;
      el.className = 'toast show' + (isWarn ? ' warn' : '');
      setTimeout(function () { el.className = 'toast' + (isWarn ? ' warn' : ''); }, 2600);
    }

    function init() {
      var stored = readStore();
      state.i18n = BOOT.i18n || {};
      state.defaultLang = BOOT.defaultLang || 'fr';
      // BOOT.session 은 예전 매직링크 경로에서만 채워졌다. 정적 사이트에서는 저장소가 유일한 출처다.
      state.session = BOOT.session || stored.session || null;
      if (state.session) writeStore({ session: state.session });
      state.lang = detectLang();
      state.tz = detectTz();
    }

    return {
      init: init, t: t, setLang: setLang, get lang() { return state.lang; },
      get tz() { return state.tz; }, set tz(v) { state.tz = v; },
      setSession: setSession, getSession: getSession, isLoggedIn: isLoggedIn, logout: logout,
      call: call, toast: toast, detectTz: detectTz,
      i18n: function () { return state.i18n; }, langs: function () { return Object.keys(state.i18n); }
    };
  })();
