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
                for (const p of ['/household', '/wallet/cards', '/portfolio', '/loyalty/accounts', '/me']) {
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

  it('CY-MEMBER-02 a member has their own alert address and sees only their own cards; mailboxes are per person', () => {
    cy.request('POST', '/api/v1/auth/register', { email: 'cy.owner2.' + stamp() + '@e2e.test', password: 'e2e-password-1', name: 'Owner' }).then((reg) => {
      const owner = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/subscription/checkout', headers: auth(owner), body: { interval: 'month' } });
      cy.request({ url: '/api/v1/household', headers: auth(owner) }).then((hh) => {
        const primary = hh.body.members.find((m: { isPrimary: boolean }) => m.isPrimary);
        cy.request({ method: 'POST', url: '/api/v1/household/members', headers: auth(owner), body: { nickname: 'Riley', relationship: 'SPOUSE' } }).then((rm) => {
          const riley = rm.body.id as string;
          cy.request('/api/v1/cards/contoso-gold').then((card) => {
            cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(owner), body: { cardId: card.body.id, profileId: primary.id, lastFour: '1111' } });
            cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(owner), body: { cardId: card.body.id, profileId: riley, lastFour: '2222' } }).then((rc) => {
              cy.request({ method: 'POST', url: `/api/v1/household/members/${riley}/invite`, headers: auth(owner) }).then((inv) => {
                const email = 'cy.riley2.' + stamp() + '@e2e.test';
                cy.request('POST', '/api/v1/auth/accept-invite', { token: tokenOf(inv.body.url), email, password: 'riley-password-9' }).then((acc) => {
                  const member = acc.body.accessToken as string;
                  cy.request({ url: '/api/v1/capture/status', headers: auth(member) }).then((ms) => {
                    expect(ms.body.cards.map((c: { walletCardId: string }) => c.walletCardId)).to.deep.eq([rc.body.id]);
                    cy.request({ url: '/api/v1/capture/status', headers: auth(owner) }).then((os) => {
                      expect(os.body.cards).to.have.length(2);
                      expect(os.body.inbox.address).not.to.eq(ms.body.inbox.address);
                    });
                  });
                  // a member's mailbox list is their own (empty), and they cannot pick another person
                  cy.request({ url: '/api/v1/mailboxes', headers: auth(member) }).its('body').should('deep.eq', []);
                  cy.request({ method: 'POST', url: '/api/v1/mailboxes', headers: auth(member), body: { label: 'x', host: 'imap.example.com', username: 'x@example.com', password: 'p', profileId: primary.id }, failOnStatusCode: false }).its('status').should('eq', 400);
                  // the owner cannot assign a mailbox to somebody else's profile
                  cy.request({ method: 'POST', url: '/api/v1/mailboxes', headers: auth(owner), body: { label: 'x', host: 'imap.example.com', username: 'x@example.com', password: 'p', profileId: '00000000-0000-4000-8000-000000000000' }, failOnStatusCode: false }).its('status').should('eq', 400);
                });
              });
            });
          });
        });
      });
    });
  });

  it('CY-MEMBER-03 a member has their own notifications, preferences and briefing; none of it reaches the owner', () => {
    cy.request('POST', '/api/v1/auth/register', { email: 'cy.owner3.' + stamp() + '@e2e.test', password: 'e2e-password-1', name: 'Owner' }).then((reg) => {
      const owner = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/subscription/checkout', headers: auth(owner), body: { interval: 'month' } });
      cy.request({ method: 'POST', url: '/api/v1/household/members', headers: auth(owner), body: { nickname: 'Riley', relationship: 'SPOUSE' } }).then((rm) => {
        const riley = rm.body.id as string;
        cy.request('/api/v1/cards/contoso-gold').then((card) => {
          const opened = new Date(Date.now() - 355 * 86_400_000).toISOString();
          cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(owner), body: { cardId: card.body.id, profileId: riley, lastFour: '2222', approvedAt: opened } });
          cy.request({ method: 'POST', url: `/api/v1/household/members/${riley}/invite`, headers: auth(owner) }).then((inv) => {
            cy.request('POST', '/api/v1/auth/accept-invite', { token: tokenOf(inv.body.url), email: 'cy.riley3.' + stamp() + '@e2e.test', password: 'riley-password-9' }).then((acc) => {
              const member = acc.body.accessToken as string;
              // their own preferences, saved for them only
              cy.request({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth(member), body: { briefingWeekly: false, quietMode: true } }).its('body').should('include', { briefingWeekly: false, quietMode: true });
              cy.request({ url: '/api/v1/notifications/preferences', headers: auth(owner) }).its('body').should('include', { quietMode: false });
              // their own briefing, built from their own card
              cy.request({ method: 'POST', url: '/api/v1/member/briefings', headers: auth(member), body: { kind: 'DAILY' } }).then((b) => {
                expect(b.body.briefing.content.kind).to.eq('DAILY');
                expect(JSON.stringify(b.body.briefing.content)).to.match(/renews/);
              });
              cy.request({ url: '/api/v1/member/briefings', headers: auth(member) }).its('body').should('have.length', 1);
              cy.request({ url: '/api/v1/member/briefings', headers: auth(owner), failOnStatusCode: false }).its('status').should('eq', 403);
              // their notification list is their own
              cy.request({ url: '/api/v1/notifications', headers: auth(member) }).its('body').should('be.an', 'array');
              cy.request({ url: '/api/v1/copilot/briefings', headers: auth(member), failOnStatusCode: false }).its('status').should('be.oneOf', [403, 404]);
            });
          });
        });
      });
    });
  });

  it('CY-MEMBER-04 editing is off until the owner allows it, then pinned to the member; the owner can mute a member', () => {
    cy.request('POST', '/api/v1/auth/register', { email: 'cy.owner4.' + stamp() + '@e2e.test', password: 'e2e-password-1', name: 'Owner' }).then((reg) => {
      const owner = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/subscription/checkout', headers: auth(owner), body: { interval: 'month' } });
      cy.request({ url: '/api/v1/household', headers: auth(owner) }).then((hh) => {
        const primary = hh.body.members.find((m: { isPrimary: boolean }) => m.isPrimary);
        cy.request({ method: 'POST', url: '/api/v1/household/members', headers: auth(owner), body: { nickname: 'Riley', relationship: 'SPOUSE' } }).then((rm) => {
          const riley = rm.body.id as string;
          cy.request({ method: 'POST', url: '/api/v1/household/members', headers: auth(owner), body: { nickname: 'Sam', relationship: 'PARENT' } }).then((sm) => {
            cy.request('/api/v1/cards/contoso-gold').then((card) => {
              cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(owner), body: { cardId: card.body.id, profileId: primary.id, lastFour: '1111' } }).then((oc) => {
                cy.request({ method: 'POST', url: `/api/v1/household/members/${riley}/invite`, headers: auth(owner) }).then((inv) => {
                  cy.request('POST', '/api/v1/auth/accept-invite', { token: tokenOf(inv.body.url), email: 'cy.riley4.' + stamp() + '@e2e.test', password: 'riley-password-9' }).then((acc) => {
                    const member = acc.body.accessToken as string;
                    cy.request({ method: 'POST', url: '/api/v1/member/cards', headers: auth(member), body: { cardId: card.body.id }, failOnStatusCode: false }).its('status').should('eq', 403);
                    // only for a member with their own sign-in
                    cy.request({ method: 'PATCH', url: `/api/v1/household/members/${sm.body.id}`, headers: auth(owner), body: { canEdit: true }, failOnStatusCode: false }).its('status').should('eq', 400);
                    cy.request({ method: 'PATCH', url: `/api/v1/household/members/${riley}`, headers: auth(owner), body: { canEdit: true } }).its('body.canEdit').should('eq', true);
                    cy.request({ method: 'POST', url: '/api/v1/member/cards', headers: auth(member), body: { cardId: card.body.id, lastFour: '5555' } }).then((mc) => {
                      expect(mc.body.profileId).to.eq(riley);
                      cy.request({ method: 'POST', url: '/api/v1/member/cards', headers: auth(member), body: { cardId: card.body.id, profileId: primary.id }, failOnStatusCode: false }).its('status').should('eq', 400);
                      cy.request({ method: 'PATCH', url: `/api/v1/member/cards/${oc.body.id}`, headers: auth(member), body: { nickname: 'mine' }, failOnStatusCode: false }).its('status').should('eq', 404);
                      cy.request({ method: 'DELETE', url: `/api/v1/member/cards/${mc.body.id}`, headers: auth(member) }).its('status').should('eq', 204);
                    });
                    // the mute: only for a member with a sign-in
                    cy.request({ method: 'PATCH', url: `/api/v1/household/members/${sm.body.id}`, headers: auth(owner), body: { notifyOwner: false }, failOnStatusCode: false }).its('status').should('eq', 400);
                    cy.request({ method: 'PATCH', url: `/api/v1/household/members/${riley}`, headers: auth(owner), body: { notifyOwner: false } }).its('body.notifyOwner').should('eq', false);
                    // removing the sign-in takes both away
                    cy.request({ method: 'DELETE', url: `/api/v1/household/members/${riley}/login`, headers: auth(owner) });
                    cy.request({ url: '/api/v1/household/members', headers: auth(owner) }).then((ms) => {
                      const r = ms.body.find((m: { id: string }) => m.id === riley);
                      expect(r.canEdit).to.eq(false);
                      expect(r.notifyOwner).to.eq(true);
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
