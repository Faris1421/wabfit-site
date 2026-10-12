/*
 * The Wab Fit sign-in page — the browser half of «ربط بضغطة».
 *
 * HOW THE OWNER GETS HERE. He taps «ربط Claude» in the app (or Connect on the
 * Wab Fit listing in ChatGPT). The assistant asks the connector, is answered
 * 401 with a pointer to Supabase Auth's OAuth 2.1 server, and sends him to its
 * authorize endpoint; Supabase Auth sends him on to THIS page with an
 * `authorization_id`. Here he signs in — once per browser — and taps «سماح»;
 * the code goes back to the assistant and the connection is made. Nothing to
 * copy, nothing to paste, no settings screen.
 *
 * WHAT THIS PAGE REFUSES TO DO, and why each refusal is here rather than
 * anywhere else:
 *
 *   * HAND A SIGN-IN TO ANYONE BUT CLAUDE OR CHATGPT. Clients register
 *     themselves (dynamic client registration — that is what makes the
 *     one-tap path possible), so any website could start this flow. The page
 *     is the one place that can say no, so it does: only a request whose
 *     redirect goes back to claude.ai or chatgpt.com can be allowed. Anything
 *     else is told so and never redirected.
 *   * APPROVE SILENTLY. «سماح» is one tap, but it is a tap, and it names who is
 *     asking and where the owner will land. That is the line between a sign-in
 *     page and a token vending machine.
 *   * RUN INSIDE A FRAME. A consent button that can be framed can be
 *     clickjacked; the page renders nothing when it is not the top window (and
 *     `_headers` forbids framing outright).
 *
 * The anon key below is the same public key the app ships with; it opens
 * nothing by itself — every call that matters carries the owner's session.
 */
(function () {
  'use strict';

  var CONFIG = {
    supabaseUrl: 'https://cijawuykugjgvmlbdvaj.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpamF3dXlrdWdqZ3ZtbGJkdmFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMTE5MDEsImV4cCI6MjEwMTY4NzkwMX0.ZBTlpau2qtFH9k5RSq0U5iXW9BG4DKHzIit1cjs7_48',
    /** The only places a Wab Fit sign-in may be handed to, by redirect host. */
    trustedApps: { 'claude.ai': 'Claude', 'chatgpt.com': 'ChatGPT' },
  };

  var STRINGS = {
    ar: {
      titleGeneric: 'ربط Wab Fit',
      titleApp: 'ربط Wab Fit مع {app}',
      loading: 'لحظة…',
      signinLead: 'سجّل الدخول بحساب Wab Fit نفسه الذي تستخدمه في التطبيق.',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      signin: 'تسجيل الدخول',
      forgot: 'نسيت كلمة المرور؟ أعد تعيينها من التطبيق.',
      consentLead: '{app} يطلب استخدام حسابك:',
      canRead: 'يقرأ وجباتك وتمارينك وقياساتك وقراءات السكر والصيام',
      canWrite: 'يسجّل ويعدّل ما تطلبه منه',
      cannot: 'لا يصل إلى رسائلك أو أصدقائك، ولا يحذف حسابك',
      account: 'الحساب: {email}',
      switchAccount: 'ليس حسابك؟',
      returnsTo: 'بعد السماح تعود إلى {host}',
      allow: 'سماح',
      deny: 'رفض',
      revokeHint: 'يمكنك قطع الربط في أي وقت من «إلغاء الرابط» في التطبيق.',
      done: 'تم الربط. جارٍ الرجوع إلى {app}…',
      doneManual: 'إن لم يحدث شيء، ارجع إلى {app}.',
      denied: 'رُفض الطلب، ولم يُربط شيء.',
      errMissing: 'الرابط ناقص. ابدأ الربط من جديد من Claude أو ChatGPT.',
      errExpired: 'انتهت صلاحية طلب الربط. ابدأ من جديد من Claude أو ChatGPT.',
      errUntrusted: 'هذا الطلب لم يأتِ من Claude أو ChatGPT، لذلك لن يُربط.',
      errCreds: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      errUnconfirmed: 'أكّد بريدك أولًا من الرسالة التي وصلتك.',
      errNetwork: 'تعذّر الاتصال. تحقّق من الإنترنت ثم حاول مرة أخرى.',
      errGeneric: 'حدث خطأ. حاول مرة أخرى.',
    },
    en: {
      titleGeneric: 'Connect Wab Fit',
      titleApp: 'Connect Wab Fit to {app}',
      loading: 'One moment…',
      signinLead: 'Sign in with the same Wab Fit account you use in the app.',
      email: 'Email',
      password: 'Password',
      signin: 'Sign in',
      forgot: 'Forgot your password? Reset it in the app.',
      consentLead: '{app} is asking to use your Wab Fit account:',
      canRead: 'Read your meals, workouts, measurements, glucose and fasts',
      canWrite: 'Log and correct what you ask it to',
      cannot: 'Never your messages or friends, and never deletes your account',
      account: 'Account: {email}',
      switchAccount: 'Not your account?',
      returnsTo: 'After you allow, you go back to {host}',
      allow: 'Allow',
      deny: 'Deny',
      revokeHint: 'You can cut the connection any time with «Revoke the link» in the app.',
      done: 'Connected. Taking you back to {app}…',
      doneManual: 'If nothing happens, go back to {app}.',
      denied: 'Declined. Nothing was connected.',
      errMissing: 'This link is incomplete. Start connecting again from Claude or ChatGPT.',
      errExpired: 'This connection request has expired. Start again from Claude or ChatGPT.',
      errUntrusted: 'This request did not come from Claude or ChatGPT, so it will not be connected.',
      errCreds: 'Wrong email or password.',
      errUnconfirmed: 'Confirm your email first, from the message we sent you.',
      errNetwork: 'Could not connect. Check your internet and try again.',
      errGeneric: 'Something went wrong. Try again.',
    },
  };

  // ── the frame refusal, before anything is drawn ──────────────────────────
  if (window.top !== window.self) {
    document.documentElement.textContent = '';
    return;
  }

  var lang = /^ar\b/i.test(navigator.language || '') ? 'ar' : 'en';
  var S = STRINGS[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  function t(key, vars) {
    var text = S[key] || STRINGS.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split('{' + name + '}').join(vars[name]);
      });
    }
    return text;
  }

  function $(id) {
    return document.getElementById(id);
  }

  // Every static label in the page, in the chosen language.
  Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) {
    el.textContent = t(el.getAttribute('data-t'));
  });
  document.title = t('titleGeneric');

  var VIEWS = ['v-loading', 'v-signin', 'v-consent', 'v-done', 'v-message'];
  function show(id) {
    VIEWS.forEach(function (v) {
      $(v).hidden = v !== id;
    });
  }

  function message(key) {
    $('message-text').textContent = t(key);
    show('v-message');
  }

  function setTitle(app) {
    var text = app ? t('titleApp', { app: app }) : t('titleGeneric');
    $('title').textContent = text;
    document.title = text;
  }

  /** The app a URL leads back to, or null when it leads anywhere else. */
  function trustedApp(rawUrl) {
    try {
      var url = new URL(rawUrl);
      if (url.protocol !== 'https:') return null;
      return Object.prototype.hasOwnProperty.call(CONFIG.trustedApps, url.hostname)
        ? { name: CONFIG.trustedApps[url.hostname], host: url.hostname }
        : null;
    } catch (e) {
      return null;
    }
  }

  function goBack(redirectUrl, app) {
    $('done-text').textContent = t('done', { app: app.name });
    $('done-manual').textContent = t('doneManual', { app: app.name });
    show('v-done');
    // `replace`, so «back» in this browser does not land on a spent consent page.
    window.setTimeout(function () {
      window.location.replace(redirectUrl);
    }, 350);
  }

  function isNetwork(error) {
    if (!error) return false;
    var name = String(error.name || '');
    var msg = String(error.message || '');
    return error.status === 0 || /RetryableFetch/i.test(name) || /fetch|network|load failed/i.test(msg);
  }

  // ── the request ──────────────────────────────────────────────────────────
  var params = new URLSearchParams(window.location.search);
  var authorizationId = params.get('authorization_id') || '';
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(authorizationId)) {
    message('errMissing');
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    message('errGeneric');
    return;
  }

  var sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'wabfit-connect-auth',
    },
  });

  var busy = false;
  function setBusy(on, buttons) {
    busy = on;
    buttons.forEach(function (id) {
      $(id).disabled = on;
    });
  }

  function showError(id, key) {
    var el = $(id);
    el.textContent = t(key);
    el.hidden = false;
  }

  function hideError(id) {
    $(id).hidden = true;
  }

  // ── step 1: is anybody signed in here? ───────────────────────────────────
  function start() {
    show('v-loading');
    sb.auth.getSession().then(function (res) {
      var session = res && res.data ? res.data.session : null;
      if (session) loadRequest();
      else showSignin();
    }, function () {
      showSignin();
    });
  }

  function showSignin() {
    setTitle(null);
    hideError('signin-error');
    show('v-signin');
    $('email').focus();
  }

  $('signin-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;
    var email = $('email').value.trim().toLowerCase();
    var password = $('password').value;
    hideError('signin-error');
    if (!email || !password) {
      showError('signin-error', 'errCreds');
      return;
    }
    setBusy(true, ['signin-btn']);
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      setBusy(false, ['signin-btn']);
      var error = res.error;
      if (error) {
        var code = String(error.code || '');
        if (code === 'email_not_confirmed' || /not confirmed/i.test(String(error.message || ''))) {
          showError('signin-error', 'errUnconfirmed');
        } else if (isNetwork(error)) {
          showError('signin-error', 'errNetwork');
        } else {
          showError('signin-error', 'errCreds');
        }
        return;
      }
      $('password').value = '';
      loadRequest();
    }, function (error) {
      setBusy(false, ['signin-btn']);
      showError('signin-error', isNetwork(error) ? 'errNetwork' : 'errGeneric');
    });
  });

  // ── step 2: what is being asked, and by whom ─────────────────────────────
  function loadRequest() {
    show('v-loading');
    sb.auth.oauth.getAuthorizationDetails(authorizationId).then(function (res) {
      var error = res.error;
      var data = res.data;
      if (error) {
        var status = Number(error.status || 0);
        if (status === 401 || status === 403) {
          // The stored session is no good any more: sign in again, same request.
          sb.auth.signOut({ scope: 'local' }).then(showSignin, showSignin);
        } else if (isNetwork(error)) {
          message('errNetwork');
        } else {
          message('errExpired');
        }
        return;
      }
      if (!data) {
        message('errGeneric');
        return;
      }

      // Already allowed before: Supabase answers with the redirect straight away.
      if (!data.authorization_id) {
        var known = trustedApp(data.redirect_url);
        if (!known) {
          message('errUntrusted');
          return;
        }
        setTitle(known.name);
        goBack(data.redirect_url, known);
        return;
      }

      var app = trustedApp(data.redirect_uri);
      if (!app) {
        setTitle(null);
        // Refuse it at the server too, without following its redirect anywhere.
        sb.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true }).then(
          function () { message('errUntrusted'); },
          function () { message('errUntrusted'); }
        );
        return;
      }

      setTitle(app.name);
      $('consent-lead').textContent = t('consentLead', { app: app.name });
      $('account').textContent = t('account', { email: (data.user && data.user.email) || '' });
      $('returns-to').textContent = t('returnsTo', { host: app.host });
      hideError('consent-error');
      show('v-consent');
      $('allow-btn').focus();
      pending = app;
    }, function (error) {
      message(isNetwork(error) ? 'errNetwork' : 'errGeneric');
    });
  }

  var pending = null;

  // ── step 3: the one tap ──────────────────────────────────────────────────
  $('allow-btn').addEventListener('click', function () {
    if (busy || !pending) return;
    var app = pending;
    hideError('consent-error');
    setBusy(true, ['allow-btn', 'deny-btn']);
    sb.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }).then(function (res) {
      if (res.error || !res.data || !res.data.redirect_url) {
        setBusy(false, ['allow-btn', 'deny-btn']);
        if (res.error && !isNetwork(res.error) && Number(res.error.status || 0) >= 400 && Number(res.error.status) < 500) {
          message('errExpired');
        } else {
          showError('consent-error', res.error && isNetwork(res.error) ? 'errNetwork' : 'errGeneric');
        }
        return;
      }
      var back = trustedApp(res.data.redirect_url);
      if (!back || back.host !== app.host) {
        message('errUntrusted');
        return;
      }
      goBack(res.data.redirect_url, back);
    }, function (error) {
      setBusy(false, ['allow-btn', 'deny-btn']);
      showError('consent-error', isNetwork(error) ? 'errNetwork' : 'errGeneric');
    });
  });

  $('deny-btn').addEventListener('click', function () {
    if (busy || !pending) return;
    var app = pending;
    setBusy(true, ['allow-btn', 'deny-btn']);
    sb.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true }).then(function (res) {
      var url = res && res.data ? res.data.redirect_url : null;
      var back = url ? trustedApp(url) : null;
      if (back && back.host === app.host) {
        // The assistant is told «access_denied» and can say so itself.
        window.location.replace(url);
        return;
      }
      message('denied');
    }, function () {
      message('denied');
    });
  });

  $('switch-btn').addEventListener('click', function () {
    if (busy) return;
    pending = null;
    sb.auth.signOut({ scope: 'local' }).then(showSignin, showSignin);
  });

  start();
})();
