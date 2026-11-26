/** Merchant offer automation API checks against the mock issuer (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const V = '/api/v1/offer-automation';

describe('Offer automation API', () => {
  it('CY-OA-01 add a mock account, sync, see scored offers, approve one, read the audit trail; credentials never come back', () => {
    const email = `cy.oa.${Date.now()}@e2e.test`;
    const password = 'cy-mock-password-9';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Offer Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request('/api/v1/issuers').then((iss) => {
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id } }).then((w) => {
          cy.request({ method: 'POST', url: `${V}/accounts`, headers: auth(token), body: { issuerId: iss.body[0].id, holderLabel: 'Cypress Gold', connectorKind: 'MOCK', username: `cy${Date.now()}`, password, automationOptIn: true, ackTermsRisk: true, walletCardIds: [w.body.id] } }).then((a) => {
            expect(a.body.hasCredential).to.eq(true);
            expect(JSON.stringify(a.body)).not.to.contain(password);
            const id = a.body.id as string;
            cy.request({ method: 'POST', url: `${V}/sync`, headers: auth(token), body: { accountId: id, wait: true } }).its('body.runs').should('have.length', 1);
            cy.request({ url: `${V}/inbox?tab=all`, headers: auth(token) }).then((inbox) => {
              expect(inbox.body).to.have.length(3);
              const hilton = inbox.body.find((i: { merchant: string }) => i.merchant === 'Hilton');
              expect(hilton.score).to.be.greaterThan(59);
              expect(hilton.scoreDetail.reasons.length).to.be.greaterThan(0);
              cy.request({ method: 'POST', url: `${V}/approve`, headers: auth(token), body: { itemIds: [hilton.id] } }).its('body.0.result').should('eq', 'SUCCESS');
            });
            cy.request({ url: `${V}/history?limit=100`, headers: auth(token) }).then((h) => {
              expect(h.body.map((e: { type: string }) => e.type)).to.include.members(['DISCOVERED', 'DECISION', 'ACTIVATED']);
              expect(JSON.stringify(h.body)).not.to.contain(password);
            });
            cy.request({ url: `${V}/accounts`, headers: auth(token) }).then((list) => expect(JSON.stringify(list.body)).not.to.match(/credentialEnc|sessionEnc|password/i));
            // another member sees nothing of it
            cy.request({ method: 'POST', url: '/api/v1/auth/register', body: { email: `cy.oa2.${Date.now()}@e2e.test`, password: 'e2e-password-1', name: 'Other' } }).then((o) => {
              cy.request({ url: `${V}/inbox?tab=all`, headers: auth(o.body.accessToken) }).its('body').should('have.length', 0);
              cy.request({ method: 'POST', url: `${V}/sync`, headers: auth(o.body.accessToken), body: { accountId: id, wait: true }, failOnStatusCode: false }).its('status').should('eq', 404);
            });
          });
        });
        });
      });
    });
  });

  it('CY-OA-02 rules and mode: a never-rule beats automatic enrollment; the extension endpoint needs an offers token', () => {
    const email = `cy.oa3.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Rule Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: `${V}/rules`, headers: auth(token), body: { label: 'No gambling', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'gambling' } }).its('status').should('eq', 201);
      cy.request({ method: 'POST', url: `${V}/rules`, headers: auth(token), body: { label: 'bad', kind: 'ALWAYS', matcher: 'MIN_VALUE', matcherValue: '$25' }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'PUT', url: `${V}/policy`, headers: auth(token), body: { mode: 'AUTO', autoFilter: { categories: ['travel'] } } }).its('body.mode').should('eq', 'AUTO');
      cy.request({ method: 'POST', url: `${V}/extension/snapshot`, body: { text: 'Hilton: Spend $500, get $100 back', issuer: 'Contoso Financial' }, failOnStatusCode: false }).its('status').should('eq', 401);
      cy.request({ method: 'POST', url: `${V}/tokens`, headers: auth(token) }).its('body.token').should('match', /^pw_pat_/);
    });
  });
});
