// The invite gate: with inviteCodeRequired the page is locked until the backend accepts a code.
// The backend is a stub: GET ?invite=CODE answers like Code.gs doGet().
const { make, type } = require('./lib/app-harness');

const GOOD = 'aaaabbbbccccddddeeeeffff';
function fakeFetch(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    const m = /[?&]invite=([^&]*)/.exec(String(url));
    if (m) {
      const code = decodeURIComponent(m[1]);
      const ok = code === GOOD;
      return { ok: true, status: 200, json: async () => ({ ok, name: ok ? 'Lopez family' : '', open: false }), text: async () => JSON.stringify({ ok }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, id: 'FF-TEST1' }), json: async () => ({ ok: true, id: 'FF-TEST1' }) };
  };
}

(async () => {
  const problems = [];
  const expect = (cond, msg) => { if (!cond) problems.push(msg); };

  // 1. Locked page, wrong code, then the right one.
  {
    const calls = [];
    const A = make({ config: { inviteCodeRequired: true, endpoint: 'https://script.example/exec' }, fetch: fakeFetch(calls) });
    await A.wait(20);
    const { w, T, $, $$ } = A;
    expect($('.gate'), 'gate shown when an invite is required');
    expect(!$('.cats'), 'products hidden behind the gate');
    expect($('#progress').hidden && $('#actionbar').hidden, 'progress and action bar hidden on the gate');
    const input = $('[data-field="invite"] input');
    expect(input, 'invite field present');
    type(w, input, 'wrong');
    $$('.gate .btn').find(b => /Continue/.test(b.textContent)).click();
    await A.wait(30);
    expect(/isn’t valid/.test(($('[data-field="invite"] .field-error') || {}).textContent || ''), 'wrong code shows the error inline');
    expect(calls.length === 1 && /invite=wrong/.test(calls[0].url), 'one GET check for the wrong code');
    type(w, $('[data-field="invite"] input'), GOOD);
    $$('.gate .btn').find(b => /Continue/.test(b.textContent)).click();
    await A.wait(30);
    expect(!$('.gate') && $('.cats'), 'right code opens the products step');
    expect(T.S.inviteOk && T.S.inviteName === 'Lopez family' && T.S.invite === GOOD, 'invite stored as verified');
    expect(!$('#progress').hidden && !$('#actionbar').hidden, 'progress and action bar back');
    expect(w.document.activeElement && w.document.activeElement.classList.contains('step-title'), 'focus moves to the step title');
    // Submitting sends the invite along.
    expect(T.buildPayload().invite === GOOD, 'payload carries the invite');
    for (const l of A.logs) if (l[0] === 'error' || l[0] === 'jsdomError') problems.push(`gate console: ${String(l[1]).slice(0, 200)}`);
    A.w.close();
  }

  // 2. A link with the code verifies by itself; a bad link falls back to the field.
  {
    const A = make({ config: { inviteCodeRequired: true, endpoint: 'https://script.example/exec' }, fetch: fakeFetch([]), hash: '#invite=' + GOOD });
    await A.wait(40);
    expect(!A.$('.gate') && A.$('.cats'), 'invite link opens the form without typing');
    expect(A.T.S.inviteFromLink && A.T.S.inviteOk, 'link invite verified');
    A.w.close();
    const B = make({ config: { inviteCodeRequired: true, endpoint: 'https://script.example/exec' }, fetch: fakeFetch([]), hash: '#invite=badbadbad' });
    await B.wait(40);
    expect(B.$('.gate') && /isn’t valid/.test((B.$('[data-field="invite"] .field-error') || {}).textContent || ''), 'bad link shows the gate with the error');
    B.w.close();
  }

  // 3. A verified invite in a saved draft skips the gate; a revoked one is caught on load.
  {
    const draft = { v: 1, items: [], savedAt: Date.now(), invite: GOOD, inviteFromLink: true, inviteOk: true, inviteName: 'Lopez family', country: 'US' };
    const A = make({ config: { inviteCodeRequired: true, endpoint: 'https://script.example/exec' }, fetch: fakeFetch([]), storage: { 'ff-order-draft-v1': draft } });
    await A.wait(40);
    expect(!A.$('.gate'), 'verified draft skips the gate');
    A.w.close();
    const revoked = Object.assign({}, draft, { invite: 'revokedrevokedrevokedrev' });
    const B = make({ config: { inviteCodeRequired: true, endpoint: 'https://script.example/exec' }, fetch: fakeFetch([]), storage: { 'ff-order-draft-v1': revoked } });
    await B.wait(60);
    expect(B.$('.gate'), 'revoked invite sends the page back to the gate on load');
    B.w.close();
  }

  // 4. Preview mode (no endpoint) accepts any code; no gate without the flag.
  {
    const A = make({ config: { inviteCodeRequired: true, endpoint: '' } });
    await A.wait(20);
    expect(A.$('.gate'), 'gate shows in preview mode too');
    type(A.w, A.$('[data-field="invite"] input'), 'anything');
    A.$$('.gate .btn').find(b => /Continue/.test(b.textContent)).click();
    await A.wait(20);
    expect(!A.$('.gate'), 'preview mode accepts a code without a backend');
    A.w.close();
    const B = make({ config: { inviteCodeRequired: false } });
    await B.wait(20);
    expect(!B.$('.gate') && B.$('.cats'), 'no gate when invites are not required');
    B.w.close();
  }

  console.log(`gate problems: ${problems.length}`);
  for (const x of problems) console.log(' -', x);
  process.exitCode = problems.length ? 1 : 0;
})();
