/** The logo files are served and the install manifest points at real icons. */
describe('Logo assets', () => {
  it('CY-LG-01 mark, logo, icons and manifest are served', () => {
    cy.request('/logo/pointwise-mark.svg').then((r) => {
      expect(r.headers['content-type']).to.match(/image\/svg\+xml/);
      expect(r.body).to.match(/^<svg /);
      expect(r.body).not.to.match(/<script|href=/i);
    });
    cy.request('/logo/pointwise-logo.svg').its('status').should('eq', 200);
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) cy.request({ url: `/icons/${f}`, encoding: 'binary' }).then((r) => expect(r.headers['content-type']).to.match(/image\/png/));
    cy.request('/manifest.webmanifest').then((r) => {
      expect(r.body.name).to.eq('Pointwise');
      expect(r.body.icons.length).to.be.greaterThan(2);
    });
  });
});
