/** Account-level benefit tracking API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Benefit audit & reconciliation API', () => {
  it('CY-BA-01 two accounts of one product never share usage; rollups add them; detections can be rejected', () => {
    const email = `cy.audit.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Auditor' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        const add = (lastFour: string) =>
          cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id, lastFour } }).its('body.id');
        add('1001').then((c1) => {
          add('1002').then((c2) => {
            const day = new Date().toISOString().slice(0, 10);
            cy.request({ method: 'POST', url: '/api/v1/transactions', headers: auth(token), body: { walletCardId: c1, amountCents: 1000, kind: 'CREDIT', description: 'UBER CASH CREDIT', occurredAt: day } })
              .its('body.benefitUpdates.0.status')
              .should('eq', 'CONFIRMED');
            cy.request({ url: '/api/v1/benefit-audit/rollup?level=account', headers: auth(token) }).then((r) => {
              const ride = (card: string) => r.body.records.find((x: { cardAccountId: string; benefitName: string }) => x.cardAccountId === card && /rideshare/i.test(x.benefitName));
              expect(ride(c1 as unknown as string).usedCents).to.eq(1000);
              expect(ride(c2 as unknown as string).usedCents).to.eq(0);
            });
            cy.request({ url: '/api/v1/benefit-audit/rollup?level=product', headers: auth(token) }).its('body.groups.0.accounts').should('eq', 2);
            cy.request({ url: '/api/v1/benefit-audit/reconciliation', headers: auth(token) }).its('body.rows').should('have.length.greaterThan', 3);
            cy.request({ url: '/api/v1/benefit-audit', headers: auth(token) }).then((a) => {
              const d = a.body.items.flatMap((i: { detections: Array<{ id: string; method: string }> }) => i.detections)[0];
              expect(d.method).to.eq('EXACT');
              cy.request({ method: 'PATCH', url: `/api/v1/benefit-audit/detections/${d.id}`, headers: auth(token), body: { decision: 'REJECT' } }).its('body.status').should('eq', 'REJECTED');
              cy.request({ url: '/api/v1/benefit-audit/rollup?level=household', headers: auth(token) }).its('body.groups.0.usedCents').should('eq', 0);
            });
          });
        });
      });
    });
  });
});
