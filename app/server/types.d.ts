// Типы платформенных модулей для локальной проверки TypeScript.
declare module '@appdeploy/client' {
    export interface WsConnection {
        connectionId: string | null;
        ready: Promise<void>;
        onMessage(fn: (message: any) => void): void;
        onOpen(fn: () => void): void;
        onClose(fn: () => void): void;
        onError(fn: (err: any) => void): void;
        disconnect(): void;
    }
    export const api: {
        get(url: string, data?: any): Promise<{ data: any }>;
        post(url: string, data?: any): Promise<{ data: any }>;
        put(url: string, data?: any): Promise<{ data: any }>;
        delete(url: string, data?: any): Promise<{ data: any }>;
    };
    export const ws: { connect(options?: { appId?: string; heartbeatIntervalMs?: number }): WsConnection };
}

declare module '@appdeploy/sdk' {
    export interface RouterContext {
        body: unknown;
        query: Record<string, string>;
        params: Record<string, string>;
        event: any;
    }
    export interface RouterResponse {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
    }
    export type RouterMiddleware = (ctx: RouterContext) => Promise<RouterResponse | void> | RouterResponse | void;
    export type RouterRoutes = Record<string, RouterMiddleware[]>;
    export function router(routes: RouterRoutes): (event: any) => Promise<RouterResponse>;
    export function json(data: unknown, status?: number): RouterResponse;
    export function error(message: string, status?: number): RouterResponse;
    export interface DbOperation<T> extends PromiseLike<T> {}
    export const db: {
        readonly tx: {
            add(table: string, records: Record<string, unknown>[]): DbOperation<(string | null)[]>;
            update(
                table: string,
                items: { id: string; record: Record<string, unknown>; if?: Record<string, unknown> }[],
                options?: { patch?: boolean },
            ): DbOperation<boolean[]>;
            delete(table: string, ids: string[]): DbOperation<boolean[]>;
        };
        add(table: string, records: Array<Record<string, unknown>>): Promise<Array<string | null>>;
        update(table: string, items: Array<{ id: string; record: Record<string, unknown> }>): Promise<boolean[]>;
        get<T = Record<string, any>>(table: string, ids: string[], options?: { consistent?: boolean }): Promise<Array<T | null>>;
        list<T = Record<string, any>>(
            table: string,
            options?: { filter?: Record<string, unknown>; nextToken?: string; limit?: number },
        ): Promise<{ items: Array<Omit<T, 'id'> & { id: string }>; nextToken?: string }>;
        delete(table: string, ids: string[]): Promise<boolean[]>;
    };
    export const ws: {
        send(connection_id: string | string[], payload: unknown): Promise<{ ok: boolean }>;
    };
}
