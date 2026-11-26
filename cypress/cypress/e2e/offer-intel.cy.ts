/** Merchant offer intelligence API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = new Date(Date.now() + 20 * 86_400_000);
const us = `${String(future.getUTCMonth() + 1).padStart(2, '0')}/${String(future.getUTCDate()).padStart(2, '0')}/${future.getUTCFullYear()}`;

describe('Offer intelligence API', () => {
  it('CY-OI-01 import → inventory with source and reliability → activate → audit trail; other users see nothing', () => {
    const email = `cy.oi.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Offer Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id } }).then((w) => {
          const walletCardId = w.body.id as string;
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/import', headers: auth(token), body: { walletCardId, text: `Hilton: Spend $500, get $100 back, expires ${us}\nnot an offer` } }).then((r) => {
            expect(r.body.created).to.have.length(1);
            expect(r.body.rejected).to.have.length(1);
          });
          cy.request({ url: '/api/v1/offers/intel/inventory', headers: auth(token) }).then((inv) => {
            const row = inv.body[0];
            expect(row).to.include({ source: 'USER_ENTERED', reliability: 25, confidenceCap: 25, activationStatus: 'PENDING' });
            cy.request({ method: 'POST', url: `/api/v1/offers/intel/activation/${row.id}`, headers: auth(token), body: { status: 'ACTIVATED' } }).its('body.activationStatus').should('eq', 'ACTIVATED');
          });
          cy.request({ url: '/api/v1/offers/intel/events', headers: auth(token) }).then((ev) => {
            expect(ev.body.map((e: { type: string }) => e.type)).to.include.members(['IMPORTED', 'ACTIVATED']);
          });
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/plan', headers: auth(token), body: { merchantText: 'Hilton', amountCents: 60000 } }).then((p) => {
            expect(p.body.plans.length).to.be.greaterThan(0);
            p.body.plans.forEach((pl: { evidence: string[] }) => expect(pl.evidence.length).to.be.greaterThan(0));
            expect(p.body.plans[0].legs[0].offerCents).to.eq(10000);
          });
          cy.request({ url: '/api/v1/offers/intel/opportunities', headers: auth(token) }).its('body.items.0.factors').should('have.length', 9);
        });
      });
    });
    const other = `cy.oi2.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email: other, password: 'e2e-password-1', name: 'Other' }).then((reg) => {
      cy.request({ url: '/api/v1/offers/intel/inventory', headers: auth(reg.body.accessToken) }).its('body').should('deep.equal', []);
    });
  });

  it('CY-OI-02 requires a signed-in user and validates the plan request', () => {
    cy.request({ url: '/api/v1/offers/intel/inventory', failOnStatusCode: false }).its('status').should('eq', 401);
    const email = `cy.oi3.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'V' }).then((reg) => {
      cy.request({ method: 'POST', url: '/api/v1/offers/intel/plan', headers: auth(reg.body.accessToken), body: { amountCents: 100 }, failOnStatusCode: false }).its('status').should('eq', 400);
    });
  });
});
