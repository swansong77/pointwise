/** Savings-and-planning dashboard API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

describe('Offer dashboards API', () => {
  it('CY-DASH-01 expirations, savings, household and merchant dashboard; other users see nothing', () => {
    const email = `cy.dash.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Dash Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id } }).then((w) => {
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/import', headers: auth(token), body: { walletCardId: w.body.id, text: `Hilton: Spend $500, get $100 back, expires ${us(5)}` } });
          cy.request({ url: '/api/v1/offers/intel/expirations', headers: auth(token) }).then((r) => {
            expect(r.body.buckets.map((b: { key: string }) => b.key)).to.deep.eq(['WEEK', 'TWO_WEEKS', 'MONTH', 'TWO_MONTHS']);
            expect(r.body.buckets[0].items.some((i: { merchant: string }) => i.merchant === 'Hilton')).to.eq(true);
          });
          cy.request({ url: '/api/v1/offers/intel/savings', headers: auth(token) }).then((r) => {
            expect(r.body.byMonth).to.have.length(12);
            expect(r.body.totals).to.have.property('savedCents');
          });
          cy.request({ url: '/api/v1/offers/intel/household', headers: auth(token) }).then((r) => {
            expect(r.body.members.length).to.be.greaterThan(0);
            expect(r.body.routing[0].advice).to.match(/should pay at Hilton/);
          });
          cy.request({ url: '/api/v1/offers/intel/merchants/hilton/dashboard', headers: auth(token) }).then((r) => {
            expect(r.body.offers.active).to.have.length(1);
            expect(r.body.bestWayToPay.basedOn).to.eq('a $500 reference purchase');
          });
          cy.request({ url: '/api/v1/offers/intel/merchants/nope-not-real/dashboard', headers: auth(token), failOnStatusCode: false }).its('status').should('eq', 404);
        });
      });
    });
    const other = `cy.dash2.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email: other, password: 'e2e-password-1', name: 'Other' }).then((reg) => {
      cy.request({ url: '/api/v1/offers/intel/household', headers: auth(reg.body.accessToken) }).its('body.totals.liveOffers').should('eq', 0);
    });
  });
});
