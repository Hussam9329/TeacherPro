import assert from 'node:assert/strict';
import { mutationCanBeReplayed } from '../src/lib/mutation-replay-policy.ts';
for (const expectedRevision of [0,1,7]) {
  assert.equal(mutationCanBeReplayed('/api/student-calls','POST',{category:'call-student-note',notes:'changed',expectedRevision}),false);
  assert.equal(mutationCanBeReplayed('/api/student-calls','PUT',{notes:'changed',expectedRevision}),false);
}
for (const expectedChecked of [false,true]) {
  assert.equal(mutationCanBeReplayed('/api/students/dismissed-check','PUT',{checked:!expectedChecked,expectedChecked}),false);
}
assert.equal(mutationCanBeReplayed('/api/student-calls','POST',{studentId:'student',examId:'exam',status:'تم الاتصال'}),true);
console.log('PASS: note revision and shared check guards prevent stale outbox replay, including zero and false; existing contact upserts remain replayable.');
