/** Offer market, smart recommendation audit, workflow runs and mailboxes (API checks). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Offer intelligence & orchestration API', () => {
  it('CY-INT-01 market, smart recommendation with audit, and an auditable workflow run', () => {
    const email = `cy.intel.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Intel' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ url: '/api/v1/offers/market', headers: auth(token) }).then((m) => {
        expect(m.body.engine).to.match(/^offer-intel\//);
        expect(m.body.offers.length).to.be.greaterThan(0);
        expect(m.body.offers[0]).to.have.property('verdict');
        expect(m.body.offers[0].difficulty).to.have.property('level');
      });
      cy.request('/api/v1/welcome-bonuses').its('body.0').should('include.keys', 'bestEverCents', 'verdict', 'advice');
      cy.request({ url: '/api/v1/recommendations/smart', headers: auth(token) }).then((s) => {
        expect(s.body.engine).to.eq('recommendation/2');
        const id = s.body.recommended?.recommendationId as string | undefined;
        if (id) {
          cy.request({ url: `/api/v1/recommendations/audit/${id}`, headers: auth(token) }).its('body.probabilityIsEstimate').should('eq', true);
          cy.request({ url: `/api/v1/recommendations/audit/${id}`, headers: auth(token), failOnStatusCode: false }).its('status').should('eq', 200);
        }
      });
      cy.request({ method: 'POST', url: '/api/v1/ai/workflows/next-card', headers: auth(token), body: { question: 'What card should I get next?' } }).then((r) => {
        expect(r.body.status).to.eq('COMPLETED');
        expect(r.body.steps.map((x: { id: string }) => x.id)).to.deep.eq(['offers', 'five24', 'portfolio', 'strategy', 'recommendation']);
        cy.request({ url: `/api/v1/ai/runs/${r.body.runId}`, headers: auth(token) }).its('body.steps').should('have.length', 5);
      });
    });
  });

  it('CY-INT-02 mailbox endpoints require sign-in and reject private hosts', () => {
    cy.request({ url: '/api/v1/mailboxes', failOnStatusCode: false }).its('status').should('eq', 401);
    const email = `cy.mbx.${Date.now()}@e2e.test`;
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Mbx' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/mailboxes', headers: auth(token), failOnStatusCode: false, body: { label: 'x', host: '127.0.0.1', username: 'a@b.co', password: 'p' } }).its('status').should('eq', 400);
      cy.request({ url: '/api/v1/mailboxes', headers: auth(token) }).its('body').should('deep.eq', []);
      cy.request({ url: '/api/v1/mailboxes/providers', headers: auth(token) }).its('body').should('include', { gmail: false, outlook: false });
      cy.request({ url: '/api/v1/mailboxes/oauth/google/start', headers: auth(token), failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ url: '/api/v1/mailboxes/oauth/callback?state=forged&code=x', followRedirect: false }).then((r) => {
        expect(r.status).to.eq(302);
        expect(decodeURIComponent(r.headers.location as string)).to.contain('sign-in link expired');
      });
    });
  });
});
