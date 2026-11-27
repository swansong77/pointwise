/** Cash-back sites API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const stamp = () => Date.now() + '.' + Math.random().toString(36).slice(2, 7);

describe('Cash-back sites API', () => {
  it('CY-CB-01 the administrator adds rates, a household picks its sites, and the recommendation follows', () => {
    cy.request('POST', '/api/v1/auth/login', { email: 'admin@pointwise.local', password: 'Admin12345!' }).then((a) => {
      const admin = a.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/admin/cashback/rates', headers: auth(admin), body: { site: 'rakuten', merchant: 'hilton', ratePercent: 2 } });
      cy.request({ method: 'POST', url: '/api/v1/admin/cashback/rates', headers: auth(admin), body: { site: 'topcashback', merchant: 'hilton', ratePercent: 9, upTo: true } });
      cy.request('POST', '/api/v1/auth/register', { email: 'cy.cb.' + stamp() + '@e2e.test', password: 'e2e-password-1', name: 'Shopper' }).then((reg) => {
        const t = reg.body.accessToken as string;
        // a household that has not said which sites it uses is asked, and gets the best overall
        cy.request({ url: '/api/v1/cashback/recommend?merchant=hilton&amount=50000', headers: auth(t) }).then((r) => {
          expect(r.body.haveAccounts).to.eq(false);
          expect(r.body.pick.site).to.eq('topcashback');
        });
        cy.request({ method: 'PUT', url: '/api/v1/cashback/accounts/rakuten', headers: auth(t), body: { has: true } }).its('status').should('eq', 204);
        cy.request({ url: '/api/v1/cashback/recommend?merchant=hilton&amount=50000', headers: auth(t) }).then((r) => {
          expect(r.body.haveAccounts).to.eq(true);
          expect(r.body.pick.site).to.eq('rakuten');
          expect(r.body.consider.site).to.eq('topcashback');
        });
        cy.request({ url: '/api/v1/cashback/sites', headers: auth(t) }).its('body').should('satisfy', (s: Array<{ code: string; accounts: unknown[] }>) => s.find((x) => x.code === 'rakuten')!.accounts.length === 1);
        // only an administrator edits the shared list
        cy.request({ method: 'POST', url: '/api/v1/admin/cashback/rates', headers: auth(t), body: { site: 'rakuten', merchant: 'hilton', ratePercent: 50 }, failOnStatusCode: false }).its('status').should('eq', 403);
        cy.request({ method: 'POST', url: '/api/v1/admin/cashback/rates/paste', headers: auth(admin), body: { site: 'topcashback', merchant: 'hilton', text: 'Free shipping', save: true }, failOnStatusCode: false }).its('status').should('eq', 400);
      });
    });
  });
});
