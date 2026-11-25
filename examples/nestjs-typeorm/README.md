# Example: NestJS + TypeORM

A billing API on NestJS 11 and TypeORM (in-memory sql.js). One line in `src/main.ts` instruments it:

```ts
stacklens.instrumentTypeORM(typeorm);
const app = await NestFactory.create(AppModule);
stacklens.instrumentNest(app);
```

Traces show controller → service → handler → repository → EntityManager → QueryBuilder → SQL, with the SQL text and parameters.

```bash
npm run example:nest   # http://localhost:3002
curl localhost:3002/orders/invoice/1
curl -XPOST localhost:3002/orders -H 'content-type: application/json' -d '{"userId":1,"amount":-1}'   # a traced 400
```
