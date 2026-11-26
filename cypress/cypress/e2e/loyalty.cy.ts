/** Loyalty asset management API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const day = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString();

describe('Loyalty API', () => {
  it('CY-LY-01 account → expiration risk → certificate → valuation → forecast; others see nothing', () => {
    const email = `cy.loyalty.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Loyal' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ url: '/api/v1/household/members', headers: auth(token) }).then((m) => {
        const profileId = m.body[0].id as string;
        cy.request({ method: 'POST', url: '/api/v1/loyalty/accounts', headers: auth(token), body: { profileId, customName: 'Cy Miles', customKind: 'AIRLINE', customCentsPerPoint: 1.5, balance: 100000, accountNumber: 'CY1234567890', expiresAt: iso(20) } }).then((a) => {
          expect(a.body.accountLast4).to.eq('7890');
          expect(JSON.stringify(a.body)).not.to.include('CY1234567890');
          expect(a.body.prediction.level).to.eq('HIGH');
          expect(a.body.valueCents).to.eq(150000);
        });
        cy.request({ method: 'POST', url: '/api/v1/loyalty/certificates', headers: auth(token), body: { profileId, category: 'FREE_NIGHT', name: 'Cy night', expiresAt: iso(45), potentialValueCents: 40000 } });
        cy.request({ method: 'POST', url: '/api/v1/loyalty/memberships', headers: auth(token), body: { profileId, kind: 'GLOBAL_ENTRY', name: 'Global Entry', expiresAt: iso(181), annualValueCents: 2400, renewalCostCents: 12000 } });
        cy.request({ url: '/api/v1/loyalty/valuation', headers: auth(token) }).then((v) => {
          expect(v.body.byCategory.points).to.eq(150000);
          expect(v.body.byCategory.certificates).to.eq(40000);
          expect(v.body.atRiskCents).to.be.greaterThan(0);
        });
        cy.request({ url: '/api/v1/loyalty/expirations', headers: auth(token) }).its('body.items.0.message').should('match', /at risk of expiration|expire in/);
        cy.request({ url: '/api/v1/loyalty/forecast', headers: auth(token) }).then((f) => {
          const all = f.body.buckets.flatMap((b: { items: Array<{ type: string }> }) => b.items.map((i) => i.type));
          expect(all).to.include.members(['POINTS', 'FREE_NIGHT', 'MEMBERSHIP']);
        });
        cy.request({ url: '/api/v1/loyalty/dashboard', headers: auth(token) }).its('body.valuation.currentCents').should('be.greaterThan', 190000);
      });
    });
    const other = `cy.loyalty2.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email: other, password: 'e2e-password-1', name: 'Other' }).then((reg) => {
      cy.request({ url: '/api/v1/loyalty/accounts', headers: auth(reg.body.accessToken) }).its('body').should('deep.equal', []);
    });
  });

  it('CY-LY-02 requires sign-in and validates input', () => {
    cy.request({ url: '/api/v1/loyalty/dashboard', failOnStatusCode: false }).its('status').should('eq', 401);
    const email = `cy.loyalty3.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'V' }).then((reg) => {
      const t = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/loyalty/accounts', headers: auth(t), body: {}, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'POST', url: '/api/v1/loyalty/award-trips', headers: auth(t), body: { destination: 'X', dateFrom: iso(10), dateTo: iso(5), cabin: 'FIRST' }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ url: '/api/v1/loyalty/programs', headers: auth(t) }).its('body.programs').should('be.an', 'array');
    });
  });
});
