/** AI platform: assistant questions, task endpoints, MCP token auth. Runs against the offline demo model. */
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('AI assistant', () => {
  it('CY-AI-01 answers spec questions for the family account', () => {
    cy.apiLogin('family@pointwise.local', 'Family12345!').then((token) => {
      cy.request({ method: 'PUT', url: '/api/v1/ai/settings', headers: auth(token), body: { consent: true } });
      cy.request({ method: 'POST', url: '/api/v1/ai/chat', headers: auth(token), body: { message: 'What benefits have I not used this year?' } }).then((r) => {
        expect(r.body.trace[0].tool).to.eq('get_benefit_summary');
        expect(r.body.answer).to.match(/Available:/);
      });
      cy.request({ method: 'POST', url: '/api/v1/ai/chat', headers: auth(token), body: { message: 'Compare Contoso Gold versus Northwind Voyager Reserve' } })
        .its('body.answer')
        .should('match', /Contoso Gold: fee \$250/);
    });
    cy.uiLogin('family@pointwise.local', 'Family12345!');
    cy.visit('/assistant');
    cy.contains('button', 'Which family member should apply next?').click();
    cy.get('[data-testid=ai-answer]').last().should('contain', 'Jordan');
  });

  it('CY-AI-02 consent gate and task endpoints via API', () => {
    cy.apiRegister().then(({ token }) => {
      cy.request({ method: 'POST', url: '/api/v1/ai/chat', headers: auth(token), body: { message: 'hi' }, failOnStatusCode: false }).its('status').should('eq', 403);
      cy.request({ method: 'PUT', url: '/api/v1/ai/settings', headers: auth(token), body: { consent: true } });
      cy.request({ method: 'POST', url: '/api/v1/ai/travel-strategy', headers: auth(token), body: {} }).its('body.agent').should('eq', 'travel-rewards');
      cy.request({ method: 'POST', url: '/api/v1/ai/unknown-task', headers: auth(token), body: {}, failOnStatusCode: false }).its('status').should('eq', 404);
    });
  });

  it('CY-AI-03 the MCP endpoint rejects requests without a personal access token', () => {
    // /mcp is served by the API (not proxied by the web app); reach it through the backend service name
    cy.request({ method: 'POST', url: 'http://backend:4000/mcp', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, failOnStatusCode: false }).its('status').should('eq', 401);
  });
});
