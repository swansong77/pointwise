/** Data export and import, backups and maintenance mode over the API (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const V = '/api/v1';
const ADMIN = { email: 'admin@pointwise.local', password: 'Admin12345!' };

describe('Data export and import API', () => {
  it('CY-DT-01 export carries no secret; import previews, merges once, and cannot cross accounts', () => {
    cy.request('POST', `${V}/auth/register`, { email: `cy.dt.${Date.now()}@e2e.test`, password: 'e2e-password-1', name: 'Exporter' }).then((a) => {
      const ta = a.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: `${V}/wallet/cards`, headers: auth(ta), body: { cardId: card.body.id } });
        cy.request({ url: `${V}/me/data-export`, headers: auth(ta) }).then((exp) => {
          const text = JSON.stringify(exp.body);
          expect(exp.body.format).to.eq('pointwise-user-data');
          expect(exp.body.models.WalletCard).to.have.length(1);
          expect(text).not.to.match(/passwordHash|accessTokenEnc|credentialEnc|secretEnc|tokenHash/);
          cy.request('POST', `${V}/auth/register`, { email: `cy.dt2.${Date.now()}@e2e.test`, password: 'e2e-password-1', name: 'Importer' }).then((b) => {
            const tb = b.body.accessToken as string;
            const form = (dryRun: string) => {
              const fd = new FormData();
              fd.append('file', new Blob([text], { type: 'application/json' }), 'x.pointwise-data.json');
              fd.append('mode', 'merge');
              fd.append('dryRun', dryRun);
              return fd;
            };
            cy.visit('/login');
            const send = (dryRun: string) =>
              cy.window().then((win) => win.fetch(`${V}/me/data-import`, { method: 'POST', headers: auth(tb), body: form(dryRun) }).then((r) => r.json()));
            send('true').then((r: any) => {
              expect(r.dryRun).to.eq(true);
              expect(r.created.WalletCard).to.eq(1);
            });
            cy.request({ url: `${V}/wallet/cards`, headers: auth(tb) }).its('body').should('have.length', 0);
            send('false').then((r: any) => expect(r.dryRun).to.eq(false));
            cy.request({ url: `${V}/wallet/cards`, headers: auth(tb) }).its('body').should('have.length', 1);
            send('false').then((r: any) => expect(r.totals.created).to.eq(0));
            cy.request({ url: `${V}/wallet/cards`, headers: auth(tb) }).its('body').should('have.length', 1);
            cy.request({ url: `${V}/wallet/cards`, headers: auth(ta) }).its('body').should('have.length', 1);
          });
        });
      });
    });
  });
});

describe('Backup and maintenance API', () => {
  it('CY-DT-02 only administrators; an encrypted backup verifies; maintenance mode answers 503 to members', () => {
    cy.request('POST', `${V}/auth/register`, { email: `cy.dt3.${Date.now()}@e2e.test`, password: 'e2e-password-1', name: 'Member' }).then((m) => {
      const tm = m.body.accessToken as string;
      cy.request({ url: `${V}/admin/backups`, headers: auth(tm), failOnStatusCode: false }).its('status').should('eq', 403);
      cy.request({ url: `${V}/admin/backups`, failOnStatusCode: false }).its('status').should('eq', 401);
      cy.request('POST', `${V}/auth/login`, ADMIN).then((adm) => {
        const ta = adm.body.accessToken as string;
        cy.request({ method: 'POST', url: `${V}/admin/backups`, headers: auth(ta), body: { passphrase: 'short' }, failOnStatusCode: false }).its('status').should('eq', 400);
        cy.request({ method: 'POST', url: `${V}/admin/backups`, headers: auth(ta), body: { passphrase: 'a-cypress-backup-passphrase' } }).then((b) => {
          expect(b.body.rows).to.be.greaterThan(100);
          cy.request({ method: 'POST', url: `${V}/admin/backups/${b.body.name}/verify`, headers: auth(ta), body: { passphrase: 'a-cypress-backup-passphrase' } }).its('body.ok').should('eq', true);
          cy.request({ method: 'POST', url: `${V}/admin/backups/${b.body.name}/verify`, headers: auth(ta), body: { passphrase: 'not the right passphrase' } }).its('body.ok').should('eq', false);
          cy.request({ method: 'DELETE', url: `${V}/admin/backups/${b.body.name}`, headers: auth(ta) }).its('status').should('eq', 204);
        });
        cy.request({ method: 'POST', url: `${V}/admin/maintenance`, headers: auth(ta), body: { on: true, reason: 'cypress check' } }).its('body.on').should('eq', true);
        cy.request({ url: `${V}/wallet/cards`, headers: auth(tm), failOnStatusCode: false }).then((r) => {
          expect(r.status).to.eq(503);
          expect(r.body.message).to.contain('cypress check');
        });
        cy.request({ url: `${V}/admin/backups`, headers: auth(ta) }).its('status').should('eq', 200);
        cy.request({ method: 'POST', url: `${V}/admin/maintenance`, headers: auth(ta), body: { on: false } }).its('body.on').should('eq', false);
        cy.request({ url: `${V}/wallet/cards`, headers: auth(tm) }).its('status').should('eq', 200);
      });
    });
  });
});
