import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Clock } from './clock.js';
import type { Database, Db } from './db.js';

/**
 * The module contract — the same shape as Mizan's AppModule (ADR-020), so one developer
 * reads both codebases the same way.
 *
 * A module owns its tables (migrations), declares its permissions (scopes), mounts its routes
 * and checks its own figures (health). It reaches other modules only through services
 * registered here — never by importing their code or writing their tables
 * (enforced by test/boundaries.test.ts).
 */
export interface Migration {
  id: string;
  up: string;
}

export interface HealthCheck {
  id: string;
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface Config {
  /** Root namespace of every global id; the same in every app of one company. */
  companyId: string;
  /** Name of this installation inside the source attribute (eco://<company>/gmes/<node>). */
  node: string;
  timeZone: string;
  /** Local time at which a production day starts, "HH:MM". */
  productionDayStart: string;
  /** Who owns items and warehouses here: Mizan when installed, else manufacturing itself (fallback owner). */
  ownership: {
    item: 'mizan' | 'gmes';
    warehouse: 'mizan' | 'gmes';
    /**
     * Who owns people. 'hr': the HR system; commands must name a known, active employee from its mirror.
     * 'none': no owner connected — person references are carried unchecked (the behaviour before HR;
     * also the rollback switch while the HR boundary is proven). Manufacturing never owns people.
     */
    person?: 'hr' | 'none';
  };
}

export interface Caller {
  /** Name of the API key / device / link that made the request. */
  name: string;
  scopes: ReadonlySet<string>;
}

export interface Ctx {
  db: Database;
  clock: Clock;
  config: Config;
  services: Services;
}

/** Typed service registry; each module augments ServiceMap with what it provides. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ServiceMap {}

export class Services {
  private map = new Map<string, unknown>();
  provide<K extends keyof ServiceMap>(name: K, service: ServiceMap[K]): void {
    if (this.map.has(name as string)) throw new Error(`service ${String(name)} provided twice`);
    this.map.set(name as string, service);
  }
  get<K extends keyof ServiceMap>(name: K): ServiceMap[K] {
    const s = this.map.get(name as string);
    if (!s) throw new Error(`service ${String(name)} is not installed`);
    return s as ServiceMap[K];
  }
  has(name: keyof ServiceMap): boolean {
    return this.map.has(name as string);
  }
}

export interface RouteKit {
  http: FastifyInstance;
  /** Resolve the caller of a request and require one of the scopes (checked on the server, always). */
  require(req: FastifyRequest, scope: string): Caller;
}

export interface AppModule {
  id: string;
  dependsOn?: string[];
  migrations?: Migration[];
  /** Scopes this module checks, `module.object.action` style. */
  scopes?: string[];
  setup?(ctx: Ctx): void;
  routes?(kit: RouteKit, ctx: Ctx): void;
  health?(ctx: Ctx): Promise<HealthCheck[]>;
}

export type { Db };
