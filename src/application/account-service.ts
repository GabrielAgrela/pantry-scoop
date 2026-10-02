import { NotFoundError, ValidationError } from '../domain/errors.ts';
import { planUsageEnabled, type User } from '../domain/user.ts';
import type { ConnectionRepository, UserRepository } from '../ports/account-repositories.ts';
import type { ModelCatalog, ModelOption } from '../ports/model-catalog.ts';

export interface AccountView {
  readonly user: Pick<User, 'id' | 'email' | 'name' | 'picture' | 'model'>;
  readonly planUsageEnabled: boolean;
  readonly showPlanWelcome: boolean;
}

export class AccountService {
  private readonly users: UserRepository;
  private readonly connections: ConnectionRepository;
  private readonly catalog: ModelCatalog;

  constructor(users: UserRepository, connections: ConnectionRepository, catalog: ModelCatalog) {
    this.users = users;
    this.connections = connections;
    this.catalog = catalog;
  }

  view(userId: number): AccountView {
    const user = this.require(userId);
    const enabled = planUsageEnabled(this.connections.find(userId));
    return {
      user: { id: user.id, email: user.email, name: user.name, picture: user.picture, model: user.model },
      planUsageEnabled: enabled,
      showPlanWelcome: enabled && !user.planWelcomeSeen,
    };
  }

  models(userId: number): Promise<ModelOption[]> {
    return this.catalog.list(userId);
  }

  /** Empty slug = automatic (first model the plan offers). */
  async setModel(userId: number, slug: unknown): Promise<AccountView> {
    if (typeof slug !== 'string') throw new ValidationError('model must be text.');
    if (slug !== '' && !(await this.catalog.list(userId)).some((model) => model.slug === slug)) {
      throw new ValidationError(`Model "${slug}" is not available on your ChatGPT plan.`);
    }
    this.users.setModel(userId, slug);
    return this.view(userId);
  }

  dismissPlanWelcome(userId: number): void {
    this.users.markPlanWelcomeSeen(userId);
  }

  private require(userId: number): User {
    const user = this.users.findById(userId);
    if (!user) throw new NotFoundError('Account not found.');
    return user;
  }
}
