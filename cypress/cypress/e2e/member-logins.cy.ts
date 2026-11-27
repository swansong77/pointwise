/** Household members with their own sign-in: API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tokenOf = (url: string) => url.split('/join/')[1];
const stamp = () => Date.now() + '.' + Math.random().toString(36).slice(2, 7);

describe('Member sign-ins API', () => {
  it('CY-MEMBER-01 invite, join, see only my data, denied elsewhere, revoked at once', () => {
    cy.request('POST', '/api/v1/auth/register', { email: 'cy.owner.' + stamp() + '@e2e.test', password: 'e2e-password-1', name: 'Owner' }).then((reg) => {
      const owner = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/subscription/checkout', headers: auth(owner), body: { interval: 'month' } });
      cy.request({ url: '/api/v1/household', headers: auth(owner) }).then((hh) => {
        const primary = hh.body.members.find((m: { isPrimary: boolean }) => m.isPrimary);
        cy.request({ method: 'POST', url: '/api/v1/household/members', headers: auth(owner), body: { nickname: 'Riley', relationship: 'SPOUSE' } }).then((rm) => {
          const riley = rm.body.id as string;
          cy.request('/api/v1/cards/contoso-gold').then((card) => {
            cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(owner), body: { cardId: card.body.id, profileId: primary.id, lastFour: '1111' } });
            cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(owner), body: { cardId: card.body.id, profileId: riley, lastFour: '2222' } });
            // the owner cannot invite themselves
            cy.request({ method: 'POST', url: `/api/v1/household/members/${primary.id}/invite`, headers: auth(owner), failOnStatusCode: false }).its('status').should('eq', 400);
            cy.request({ method: 'POST', url: `/api/v1/household/members/${riley}/invite`, headers: auth(owner) }).then((inv) => {
              const token = tokenOf(inv.body.url);
              const email = 'cy.riley.' + stamp() + '@e2e.test';
              cy.request({ method: 'POST', url: '/api/v1/auth/accept-invite', body: { token, email, password: 'weak', name: 'R' }, failOnStatusCode: false }).its('status').should('eq', 400);
              cy.request('POST', '/api/v1/auth/accept-invite', { token, email, password: 'riley-password-9', name: 'Riley' }).then((acc) => {
                const member = acc.body.accessToken as string;
                expect(acc.body.user.member).to.include({ nickname: 'Riley', visibility: 'OWN' });
                // the link works once
                cy.request({ method: 'POST', url: '/api/v1/auth/accept-invite', body: { token, email: 'x' + email, password: 'riley-password-9' }, failOnStatusCode: false }).its('status').should('eq', 404);
                // my view: only Riley's card
                cy.request({ url: '/api/v1/member/overview', headers: auth(member) }).then((ov) => {
                  expect(ov.body.cards.counts.total).to.eq(1);
                  expect(JSON.stringify(ov.body)).to.contain('2222').and.not.to.contain('1111');
                });
                // everything else is denied
                for (const p of ['/household', '/wallet/cards', '/portfolio', '/notifications', '/me']) {
                  cy.request({ url: '/api/v1' + p, headers: auth(member), failOnStatusCode: false }).its('status').should('eq', 403);
                }
                cy.request({ url: '/api/v1/member/household', headers: auth(member), failOnStatusCode: false }).its('status').should('eq', 403);
                cy.request({ method: 'PATCH', url: `/api/v1/household/members/${riley}`, headers: auth(owner), body: { visibility: 'HOUSEHOLD' } });
                cy.request({ url: '/api/v1/member/household', headers: auth(member) }).its('body.members').should('have.length', 2);
                // removing the sign-in locks the member out at once
                cy.request({ method: 'DELETE', url: `/api/v1/household/members/${riley}/login`, headers: auth(owner) }).its('status').should('eq', 204);
                cy.request({ url: '/api/v1/member/me', headers: auth(member), failOnStatusCode: false }).its('status').should('eq', 401);
                cy.request({ method: 'POST', url: '/api/v1/auth/login', body: { email, password: 'riley-password-9' }, failOnStatusCode: false }).its('status').should('eq', 401);
              });
            });
          });
        });
      });
    });
  });
});
