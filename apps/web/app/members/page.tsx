import { InvitationRecord, MemberRecord } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ActionForm } from '@/components/action-form';
import { changeRole, removeMember, revokeMemberInvitation } from '@/lib/actions/members';
import { api, currentUser } from '@/lib/api';
import { InviteMemberForm } from './invite-member-form';

export const dynamic = 'force-dynamic';

const ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
const rank = (role: string) => ROLES.indexOf(role as (typeof ROLES)[number]);

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const me = await currentUser();
  if (!me) redirect('/login?next=/members');
  const { org } = await searchParams;
  const membership = me.memberships.find((m) => m.organizationId === org) ?? me.memberships[0];
  if (!membership) redirect('/onboarding');
  const isAdmin = rank(membership.role) >= rank('admin');
  const grantable = ROLES.filter((role) => rank(role) <= rank(membership.role));
  const [members, invitations] = await Promise.all([
    api(`/v1/organizations/${membership.organizationId}/members`, {
      schema: z.object({ items: z.array(MemberRecord) }),
    }),
    isAdmin
      ? api(`/v1/organizations/${membership.organizationId}/invitations`, {
          schema: z.object({ items: z.array(InvitationRecord) }),
        })
      : Promise.resolve({ items: [] }),
  ]);
  return (
    <div className="stack">
      <h1>Members — {membership.organizationName}</h1>
      {me.memberships.length > 1 ? (
        <p className="small inline-links">
          Organization:{' '}
          {me.memberships.map((m) => (
            <a key={m.organizationId} href={`/members?org=${m.organizationId}`}>
              {m.organizationName}
            </a>
          ))}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.items.map((member) => {
            const self = member.userId === me.user.id;
            const manageable = isAdmin && !self && (member.role !== 'owner' || membership.role === 'owner');
            return (
              <tr key={member.userId}>
                <td>
                  {member.displayName}
                  {self ? <span className="small muted"> (you)</span> : null}
                </td>
                <td className="small">{member.email}</td>
                <td>
                  {manageable ? (
                    <ActionForm action={changeRole} submitLabel="Change" className="row">
                      <input type="hidden" name="orgId" value={membership.organizationId} />
                      <input type="hidden" name="userId" value={member.userId} />
                      <select
                        name="role"
                        defaultValue={member.role}
                        aria-label={`Role of ${member.displayName}`}
                      >
                        {grantable.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  ) : (
                    member.role
                  )}
                </td>
                <td>
                  {manageable || self ? (
                    <ActionForm action={removeMember} submitLabel={self ? 'Leave organization' : 'Remove'}>
                      <input type="hidden" name="orgId" value={membership.organizationId} />
                      <input type="hidden" name="userId" value={member.userId} />
                      {self ? <input type="hidden" name="self" value="1" /> : null}
                    </ActionForm>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {isAdmin ? (
        <>
          <h2>Invite colleagues</h2>
          <InviteMemberForm orgId={membership.organizationId} roles={grantable} />
          {invitations.items.length > 0 ? (
            <table>
              <tbody>
                {invitations.items.slice(0, 50).map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td className="small">{invitation.role}</td>
                    <td className="small">{invitation.status}</td>
                    <td>
                      {invitation.status === 'pending' ? (
                        <form action={revokeMemberInvitation}>
                          <input type="hidden" name="orgId" value={membership.organizationId} />
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <button type="submit">Revoke</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : (
        <p className="small muted">Ask an admin of your organization to invite colleagues.</p>
      )}
    </div>
  );
}
