/** Unified offer inventory and card detail API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = new Date(Date.now() + 20 * 86_400_000);
const us = `${String(future.getUTCMonth() + 1).padStart(2, '0')}/${String(future.getUTCDate()).padStart(2, '0')}/${future.getUTCFullYear()}`;

describe('Offer inventory API', () => {
  it('CY-INV-01 unified inventory with lifecycle, filters and summary; card detail; other users see nothing', () => {
    const email = `cy.inv.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Inventory Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id } }).then((w) => {
          const walletCardId = w.body.id as string;
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/import', headers: auth(token), body: { walletCardId, text: `Hilton: Spend $500, get $100 back, expires ${us}` } });
          cy.request({ url: '/api/v1/offers/intel/inventory/unified', headers: auth(token) }).then((inv) => {
            expect(inv.body.total).to.eq(1);
            expect(inv.body.items[0]).to.include({ origin: 'USER_OFFER', state: 'ADDED', valueCents: 10000 });
            expect(inv.body.items[0].cardholder).to.be.a('string');
            expect(inv.body.summary).to.include({ total: 1, live: 1 });
          });
          cy.request({ url: '/api/v1/offers/intel/inventory/unified?q=amex', headers: auth(token) }).its('body.total').should('eq', 0);
          cy.request({ url: '/api/v1/offers/intel/inventory/unified?q=hilton&expiresWithinDays=30&states=ADDED', headers: auth(token) }).its('body.total').should('eq', 1);
          cy.request({ url: '/api/v1/offers/intel/inventory/unified?states=REDEEMED', headers: auth(token) }).its('body.total').should('eq', 0);
          cy.request({ url: `/api/v1/offers/intel/cards/${walletCardId}`, headers: auth(token) }).then((d) => {
            expect(d.body.card.walletCardId).to.eq(walletCardId);
            expect(d.body.offers.pending).to.have.length(1);
            expect(d.body.offers.active).to.have.length(0);
            expect(d.body.savings).to.have.property('totalCents');
          });
          const other = `cy.inv2.${Date.now()}@e2e.test`;
          cy.request('POST', '/api/v1/auth/register', { email: other, password: 'e2e-password-1', name: 'Other' }).then((o) => {
            const ot = o.body.accessToken as string;
            cy.request({ url: '/api/v1/offers/intel/inventory/unified', headers: auth(ot) }).its('body.total').should('eq', 0);
            cy.request({ url: `/api/v1/offers/intel/cards/${walletCardId}`, headers: auth(ot), failOnStatusCode: false }).its('status').should('eq', 403);
          });
        });
      });
    });
  });
});
