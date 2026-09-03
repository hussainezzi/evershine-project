/**
 * School OS — authentication
 *
 * Google Sign-In is deliberately not used: parents in this market do not have
 * Google accounts, and an anonymous web app receives an empty active user
 * anyway. Identity is a row in Core!Users, keyed by phone number (parents) or
 * username (staff).
 */

var Auth = (function () {

  var TOKEN_TTL_SECONDS = 8 * 60 * 60;
  var MAX_FAILED = 5;

  function usersTable_() {
    return Repo.readCached(SS_KEY.CORE, 'Users');
  }

  function findUser_(loginId) {
    var target = String(loginId).trim().toLowerCase();
    var rows = usersTable_();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].login_id).trim().toLowerCase() === target) return rows[i];
    }
    return null;
  }

  function issueToken_(user) {
    var payload = {
      userId: user.user_id,
      personId: user.person_id,
      personType: user.person_type,
      name: user.display_name,
      role: user.role,
      scope: {
        type: user.scope_type,
        ids: String(user.scope_ids || '').split(',').map(function (s) { return s.trim(); })
               .filter(String)
      },
      year: APP.year,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    };
    var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload)).replace(/=+$/, '');
    return body + '.' + sign_(body);
  }

  /**
   * Verifies signature and expiry. Returns the session, or throws.
   * Every guarded endpoint funnels through here.
   */
  function verify(token) {
    if (!token || String(token).indexOf('.') === -1) {
      throw new Error('AUTH: please sign in again.');
    }
    var parts = String(token).split('.');
    var body = parts[0], sig = parts[1];
    if (sign_(body) !== sig) throw new Error('AUTH: session is not valid.');

    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString();
    var session = JSON.parse(json);
    if (session.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('AUTH: session expired, please sign in again.');
    }
    return session;
  }

  function rateKey_(loginId) {
    return 'login_attempt:' + String(loginId).toLowerCase();
  }

  function login(loginId, pin) {
    if (!loginId || !pin) throw new Error('Enter your ID and PIN.');

    // Cheap per-identifier throttle in front of the sheet read.
    var attempts = Number(cacheGet_(rateKey_(loginId)) || 0);
    if (attempts >= MAX_FAILED) {
      throw new Error('Too many attempts. Wait 15 minutes and try again.');
    }

    var user = findUser_(loginId);
    if (!user || String(user.status) !== 'active') {
      cachePut_(rateKey_(loginId), attempts + 1, 900);
      throw new Error('No active account for that ID.');
    }

    if (hashPin_(String(pin), String(user.salt)) !== String(user.pin_hash)) {
      cachePut_(rateKey_(loginId), attempts + 1, 900);
      Repo.updateRow(SS_KEY.CORE, 'Users', user._row, {
        failed_count: Number(user.failed_count || 0) + 1
      });
      throw new Error('Wrong PIN.');
    }

    cachePut_(rateKey_(loginId), 0, 1);

    // Deliberately NOT writing last_login here. Any write to Users invalidates
    // its cache, and on a busy morning that would mean re-reading the whole
    // user table on every single sign-in. The audit log below already records
    // who signed in and when, which is the only reason the column existed.

    var token = issueToken_(user);
    var session = verify(token);
    Repo.audit(session, 'login', 'user', user.user_id);
    return { token: token, session: publicSession(session) };
  }

  /** Never send hashes or internal scope plumbing to the browser. */
  function publicSession(session) {
    return {
      name: session.name,
      role: session.role,
      personId: session.personId,
      personType: session.personType,
      year: session.year,
      scopeType: session.scope.type,
      scopeIds: session.scope.ids
    };
  }

  function createUser(opts) {
    var salt = newSalt_();
    return {
      user_id: opts.user_id,
      person_id: opts.person_id,
      person_type: opts.person_type,
      login_id: opts.login_id,
      display_name: opts.display_name,
      pin_hash: hashPin_(String(opts.pin), salt),
      salt: salt,
      role: opts.role,
      scope_type: opts.scope_type,
      scope_ids: opts.scope_ids || '',
      status: 'active',
      last_login: '',
      failed_count: 0
    };
  }

  return {
    login: login,
    verify: verify,
    createUser: createUser,
    publicSession: publicSession
  };
})();
