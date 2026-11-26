/** Phase H API checks: statement import → automatic benefit tracking. */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Spending & automatic benefit tracking', () => {
  it('CY-SP-01 a statement credit confirms the expected rideshare usage; duplicates are skipped', () => {
    const email = `cy.spend.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Spender' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id, approvedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() } }).then((wc) => {
          const walletCardId = wc.body.id as string;
          const day = new Date().toISOString().slice(0, 10);
          cy.request({ method: 'POST', url: '/api/v1/transactions', headers: auth(token), body: { walletCardId, amountCents: 1800, description: 'LYFT RIDE', occurredAt: day } })
            .its('body.benefitUpdates.0')
            .should('include', { benefit: 'Rideshare credit', amountCents: 1000, status: 'EXPECTED' });
          cy.request({ method: 'POST', url: '/api/v1/transactions', headers: auth(token), body: { walletCardId, amountCents: 1000, kind: 'CREDIT', description: 'LYFT CREDIT', occurredAt: day } })
            .its('body.benefitUpdates.0.status')
            .should('eq', 'CONFIRMED');
          cy.request({ url: `/api/v1/benefits?walletCardId=${walletCardId}`, headers: auth(token) }).then((r) => {
            const ride = r.body.find((b: { name: string }) => b.name === 'Rideshare credit');
            expect(ride.currentPeriod.usedCents).to.eq(1000);
            expect(ride.usages[0]).to.include({ source: 'AUTO_PURCHASE', status: 'CONFIRMED' });
          });
          cy.request({ url: '/api/v1/spending/transactions?matched=true', headers: auth(token) }).its('body').should('have.length', 2);
        });
      });
    });
  });
});
