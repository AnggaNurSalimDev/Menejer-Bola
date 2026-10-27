// Jangkauan seorang pemain terhadap bola di titik tertentu.
// Satu-satunya sumber aturan ini, dipakai oleh fisika (touch.js) dan
// oleh otak pemain (roles.js), supaya perkiraan dan kenyataan selalu sama.

import { CONTROL_RADIUS, KEEPER_REACH } from './constants.js';
import { insideOwnPenaltyArea } from './pitch.js';

export function controlRadiusAt(player, point) {
  if (typeof player.attacksRight !== 'boolean') {
    throw new TypeError(`controlRadiusAt: pemain ${player.id} tidak punya attacksRight`);
  }
  if (player.role === 'GK' && insideOwnPenaltyArea(point, player.attacksRight)) {
    // Jangkauan kiper dari stat Refleks; KEEPER_REACH hanya cadangan bila profil tidak ada.
    return player.profile?.keeperReach ?? KEEPER_REACH;
  }
  return CONTROL_RADIUS;
}
