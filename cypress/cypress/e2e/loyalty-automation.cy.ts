/** Loyalty automation API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Loyalty automation API', () => {
  it('CY-LA-01 extension token scope: snapshots need the token; the token cannot call user endpoints', () => {
    const email = `cy.la.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Auto' }).then((reg) => {
      const jwt = reg.body.accessToken as string;
      const page = { program: 'MAR_BONVOY', text: 'Your current points balance is 85,400. Member number ending 4821.' };
      cy.request({ method: 'POST', url: '/api/v1/loyalty/ingest/snapshot', body: page, failOnStatusCode: false }).its('status').should('eq', 401);
      cy.request({ method: 'POST', url: '/api/v1/loyalty/tokens', headers: auth(jwt), body: { name: 'cy' } }).then((t) => {
        expect(t.body.scopes).to.deep.eq(['loyalty:ingest']);
        const token = t.body.token as string;
        cy.request({ method: 'POST', url: '/api/v1/loyalty/ingest/snapshot', headers: auth(token), body: page }).then((r) => {
          expect(r.body.accepted).to.eq(true);
          expect(r.body.unmatched).to.match(/No MAR_BONVOY account/); // nothing is invented for an account that does not exist
        });
        cy.request({ method: 'POST', url: '/api/v1/loyalty/ingest/snapshot', headers: auth(token), body: { program: 'NOPE', text: page.text }, failOnStatusCode: false }).its('status').should('eq', 400);
        cy.request({ url: '/api/v1/loyalty/accounts', headers: auth(token), failOnStatusCode: false }).its('status').should('eq', 401);
        cy.request({ method: 'DELETE', url: `/api/v1/loyalty/tokens/${t.body.id}`, headers: auth(jwt) }).its('status').should('eq', 204);
        cy.request({ method: 'POST', url: '/api/v1/loyalty/ingest/snapshot', headers: auth(token), body: page, failOnStatusCode: false }).its('status').should('eq', 401);
      });
    });
  });

  it('CY-LA-02 email sample preview, health and audit', () => {
    const email = `cy.la2.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Auto2' }).then((reg) => {
      const t = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/loyalty/import/email-sample', headers: auth(t), body: { fromDomain: 'hilton.com', subject: 'Points expiring', text: '10,000 points will expire on 03/01/2027 unless you have account activity.' } }).then((r) => {
        expect(r.body).to.include({ program: 'Hilton Honors', kind: 'EXPIRY' });
        expect(r.body.observations.map((o: { field: string }) => o.field)).to.include.members(['expiresAt', 'expiringPoints']);
      });
      cy.request({ url: '/api/v1/loyalty/health', headers: auth(t) }).its('body.household.score').should('be.within', 0, 100);
      cy.request({ url: '/api/v1/loyalty/audit', headers: auth(t) }).its('body.questions').should('have.length', 8);
      cy.request({ url: '/api/v1/loyalty/refresh-status', headers: auth(t) }).its('body.accounts').should('deep.equal', []);
      cy.request({ url: '/api/v1/loyalty/health', failOnStatusCode: false }).its('status').should('eq', 401);
    });
  });
});
