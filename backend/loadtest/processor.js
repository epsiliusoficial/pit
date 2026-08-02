// Le asigna a cada usuario virtual del test un JWT real (de gen-users.js) y el
// chatId real del que es miembro (de gen-chat.js) — así el join_room que hace
// el escenario pasa por la autorización real, no un bypass.
const users = require('./users.json');
const { chatId } = require('./chat.json');

let counter = 0;

function assignUser(context, events, done) {
  const user = users[counter % users.length];
  counter++;
  context.vars.token = user.token;
  context.vars.chatId = chatId;
  return done();
}

module.exports = { assignUser };
