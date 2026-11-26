/** Phase D/E API checks: next-card scorer, travel, streaming endpoint, operations. */
const FAMILY = { email: 'family@pointwise.local', password: 'Family12345!' };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Recommendations & travel', () => {
  it('CY-NC-01 who should apply: a Northwind card goes to Riley; household plan has a pick', () => {
    cy.apiLogin(FAMILY.email, FAMILY.password).then((token) => {
      cy.request({ url: '/api/v1/recommendations/who-should-apply/northwind-shopper', headers: auth(token) }).its('body.best.member').should('eq', 'Riley');
      cy.request({ url: '/api/v1/household/next-card', headers: auth(token) }).then((r) => {
        expect(r.body.pick.eligible).to.eq(true);
        expect(r.body.members.map((m: { member: string }) => m.member)).to.deep.eq(['Jordan', 'Riley', 'Sam']);
      });
    });
  });

  it('CY-TR-01 transfer partners are public; award plan pools household miles', () => {
    cy.request('/api/v1/transfer-partners?currency=CONTOSO_PTS').its('body.currencies.0.options.0.program').should('eq', 'AEROLINK');
    cy.apiLogin(FAMILY.email, FAMILY.password).then((token) => {
      cy.request({ method: 'POST', url: '/api/v1/travel/plan', headers: auth(token), body: { program: 'SKYHIGH', points: 200000 } }).then((r) => {
        expect(r.body.shortfall).to.eq(0);
        expect(r.body.steps.some((s: { member: string }) => s.member === 'Riley')).to.eq(true);
      });
    });
  });

  it('CY-OPS-01 streaming endpoint answers as server-sent events; ops health is admin-only', () => {
    cy.apiLogin(FAMILY.email, FAMILY.password).then((token) => {
      cy.request({ method: 'PUT', url: '/api/v1/ai/settings', headers: auth(token), body: { consent: true } });
      cy.request({ method: 'POST', url: '/api/v1/ai/chat/stream', headers: auth(token), body: { message: 'What is my current 5/24 status?' } }).then((r) => {
        expect(r.headers['content-type']).to.contain('text/event-stream');
        expect(r.body).to.contain('event: done');
        expect(r.body).to.contain('Jordan: 5/24');
      });
      cy.request({ url: '/api/v1/admin/ops/health', headers: auth(token), failOnStatusCode: false }).its('status').should('eq', 403);
    });
    cy.apiLogin('admin@pointwise.local', 'Admin12345!').then((admin) => {
      cy.request({ url: '/api/v1/admin/ops/health', headers: auth(admin) }).its('body.dependencies.database.ok').should('eq', true);
    });
  });

  it('CY-TR-02 fine-print search is public and returns highlighted snippets', () => {
    cy.request('/api/v1/card-terms/search?q=lounge%20access').then((r) => {
      expect(r.body.hits[0].card).to.eq('Northwind Voyager Reserve');
      expect(r.body.hits[0].snippet).to.match(/«/);
    });
    cy.request({ url: '/api/v1/card-terms/search?q=x', failOnStatusCode: false }).its('status').should('eq', 400);
  });
});
