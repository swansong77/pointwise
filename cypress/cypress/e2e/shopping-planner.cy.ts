/** Shopping planner API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

describe('Shopping planner API', () => {
  it('CY-SP-01 item plan → strategies, expiry impact, household advice → save → update outcome; other users are refused', () => {
    const email = `cy.sp.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Planner Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id } }).then((w) => {
          const walletCardId = w.body.id as string;
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/import', headers: auth(token), body: { walletCardId, text: `Hilton: Spend $500, get $100 back, expires ${us(20)}` } });
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/plan', headers: auth(token), body: { item: 'Hilton stay', merchantText: 'Hilton', amountCents: 120000, priority: 'HIGH', save: true } }).then((p) => {
            expect(p.body.plans.length).to.be.greaterThan(0);
            expect(p.body.strategies.map((s: { key: string }) => s.key)).to.include.members(['BEST', 'CONSERVATIVE', 'MAX_REWARDS']);
            expect(p.body.plans[0].breakdown).to.have.property('offersCents');
            expect(p.body.plans[0].netCostCents).to.eq(120000 - p.body.plans[0].totalValueReturnedCents);
            expect(p.body.expiryImpact[0]).to.include({ kind: 'OFFER', potentialLossCents: 10000 });
            expect(p.body.household.best.member).to.be.a('string');
            const id = p.body.plannedPurchaseId as string;
            cy.request({ method: 'PATCH', url: `/api/v1/offers/intel/planned/${id}`, headers: auth(token), body: { status: 'DONE', actualCents: 11000, chosenWalletCardId: walletCardId } }).its('body').should('include', { status: 'DONE', actualCents: 11000 });
            const other = `cy.sp2.${Date.now()}@e2e.test`;
            cy.request('POST', '/api/v1/auth/register', { email: other, password: 'e2e-password-1', name: 'Other' }).then((o) => {
              cy.request({ method: 'PATCH', url: `/api/v1/offers/intel/planned/${id}`, headers: auth(o.body.accessToken), body: { status: 'CANCELLED' }, failOnStatusCode: false }).its('status').should('eq', 404);
            });
          });
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/plan', headers: auth(token), body: { amountCents: 1000 }, failOnStatusCode: false }).its('status').should('eq', 400);
        });
      });
    });
  });
});
