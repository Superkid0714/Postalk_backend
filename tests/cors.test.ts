import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCorsOrigins } from '../lib/cors.ts';

test('deployment CORS uses explicit origins without granting suffix-matching hosts',()=>{
 const origins=parseCorsOrigins(' https://frontend.example.com/,https://preview.example.com ');
 assert.ok(origins.has('https://frontend.example.com'));
 assert.ok(!origins.has('https://frontend.example.com.attacker.test'));
 assert.ok(!origins.has('http://localhost:5173'));
});
test('CORS rejects credentials, paths, wildcards and non-HTTP schemes',()=>{
 for(const raw of ['*','https://user:password@example.com','https://example.com/path','https://example.com?token=1','file:///tmp','null']) {
  assert.throws(()=>parseCorsOrigins(raw));
 }
});
test('existing development origins remain available without deployment overrides',()=>{
 assert.ok(parseCorsOrigins().has('http://localhost:5173'));
});
