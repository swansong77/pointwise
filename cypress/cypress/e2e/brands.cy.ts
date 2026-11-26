/** Brand logo assets are served by the app itself, as plain images. */
describe('Brand logo assets', () => {
  it('CY-BR-01 vendored icons are served as SVG, contain no script, and the licence text ships with them', () => {
    for (const key of ['chase', 'american-express', 'delta', 'marriott', 'visa', 'mastercard']) {
      cy.request(`/brands/${key}.svg`).then((r) => {
        expect(r.status).to.eq(200);
        expect(r.headers['content-type']).to.match(/image\/svg\+xml/);
        expect(r.body).to.match(/^<svg /);
        expect(r.body).not.to.match(/<script|javascript:|onload=|href=/i);
      });
    }
    cy.request('/brands/LICENSE-simple-icons.md').its('body').should('include', 'CC0 1.0 Universal');
    cy.request({ url: '/brands/no-such-brand.svg', failOnStatusCode: false }).its('status').should('eq', 404);
  });
});
