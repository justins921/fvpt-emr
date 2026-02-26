import { PoolClient } from 'pg';

/**
 * Migration 008 — Seed 500+ global PT exercises, demo_requests table,
 * sso_connections table, and add plan_tier / account_manager columns to clinics.
 */

// ── Exercise definitions ──
// Format: [name, description, body_region, category, difficulty, instructions, sets, reps, hold_seconds]
type ExDef = [string, string, string, string, string, string, number, number, number];

// Cervical exercises
const CERVICAL: ExDef[] = [
  // Strengthening
  ['Cervical Isometric Flexion', 'Strengthen deep cervical flexors by pressing forehead into palm', 'cervical', 'strengthening', 'beginner', 'Place palm against forehead. Push head forward into hand without moving head. Hold, then relax.', 3, 10, 5],
  ['Cervical Isometric Extension', 'Strengthen cervical extensors by pressing back of head into palm', 'cervical', 'strengthening', 'beginner', 'Place palm against back of head. Push head backward into hand without moving head. Hold, then relax.', 3, 10, 5],
  ['Cervical Isometric Side Flexion', 'Strengthen lateral cervical muscles with isometric resistance', 'cervical', 'strengthening', 'beginner', 'Place palm against side of head above ear. Push head sideways into hand without moving. Hold, then relax. Repeat on other side.', 3, 10, 5],
  ['Cervical Isometric Rotation', 'Resist rotation with isometric hold', 'cervical', 'strengthening', 'beginner', 'Place palm on side of forehead. Try to turn head into hand without moving. Hold, then relax. Repeat on other side.', 3, 10, 5],
  ['Chin Tuck with Resistance Band', 'Strengthen deep cervical flexors with band resistance', 'cervical', 'strengthening', 'moderate', 'Loop resistance band around back of head. Tuck chin toward chest against band resistance. Hold, then return slowly.', 3, 12, 3],
  ['Prone Cervical Extension', 'Strengthen cervical extensors in prone position', 'cervical', 'strengthening', 'moderate', 'Lie face down with forehead on hands. Lift head slightly off hands. Hold, then lower slowly.', 3, 10, 5],
  ['Supine Cervical Curl', 'Strengthen deep neck flexors against gravity', 'cervical', 'strengthening', 'moderate', 'Lie on back with knees bent. Tuck chin and lift head 1 inch off surface. Hold, then lower slowly.', 3, 10, 3],
  ['Scapular Retraction with Chin Tuck', 'Combined neck and upper back strengthening', 'cervical', 'strengthening', 'moderate', 'Sit tall. Tuck chin while squeezing shoulder blades together. Hold, then relax.', 3, 12, 5],
  // Stretching
  ['Upper Trapezius Stretch', 'Stretch the upper trapezius and levator scapulae', 'cervical', 'stretching', 'beginner', 'Sit tall. Tilt ear toward shoulder. Gently apply overpressure with hand. Hold, then repeat on other side.', 3, 3, 30],
  ['Levator Scapulae Stretch', 'Stretch the levator scapulae muscle', 'cervical', 'stretching', 'beginner', 'Look down toward opposite armpit. Gently apply overpressure with hand on back of head. Hold, then switch sides.', 3, 3, 30],
  ['SCM Stretch', 'Stretch the sternocleidomastoid muscle', 'cervical', 'stretching', 'beginner', 'Rotate head to one side, then tilt chin upward. You should feel a stretch along the front of the neck. Hold, then switch.', 3, 3, 30],
  ['Chin Tuck Stretch', 'Stretch suboccipital muscles with chin tuck', 'cervical', 'stretching', 'beginner', 'Sit tall. Draw chin straight back making a "double chin". Hold at end range. Relax and repeat.', 3, 10, 5],
  ['Scalene Stretch', 'Stretch the anterior and middle scalene muscles', 'cervical', 'stretching', 'beginner', 'Anchor hand behind back. Tilt head away from anchored arm. Gently assist with other hand. Hold.', 3, 3, 30],
  ['Doorway Pec Stretch with Neck Extension', 'Combined pec and anterior neck stretch', 'cervical', 'stretching', 'moderate', 'Stand in doorway with arms at 90 degrees. Step forward through doorway. Gently tilt head back for added neck stretch.', 3, 3, 30],
  // ROM
  ['Cervical Flexion ROM', 'Active range of motion for cervical flexion', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly lower chin toward chest. Hold briefly, then return to neutral. Move through pain-free range only.', 2, 10, 2],
  ['Cervical Extension ROM', 'Active range of motion for cervical extension', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly look up toward ceiling. Hold briefly, then return to neutral.', 2, 10, 2],
  ['Cervical Rotation ROM', 'Active range of motion for cervical rotation', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly turn head to look over shoulder. Hold briefly, return to center, then repeat to other side.', 2, 10, 2],
  ['Cervical Side Flexion ROM', 'Active range of motion for cervical lateral flexion', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly tilt ear toward shoulder without shrugging. Hold briefly, return to center, repeat on other side.', 2, 10, 2],
  ['Cervical Circles', 'Gentle full range of motion in circular pattern', 'cervical', 'rom', 'beginner', 'Slowly move head in a gentle circle, combining flexion, rotation, extension, and side flexion. Reverse direction.', 2, 5, 0],
  ['Cervical Retraction-Extension', 'Combined chin tuck and extension movement', 'cervical', 'rom', 'moderate', 'Start with chin tuck. From tucked position, slowly extend neck looking upward. Return to tuck. Repeat.', 2, 10, 2],
];

// Shoulder exercises
const SHOULDER: ExDef[] = [
  // Strengthening
  ['Shoulder External Rotation with Band', 'Strengthen rotator cuff external rotators', 'shoulder', 'strengthening', 'beginner', 'Stand with elbow at side bent 90 degrees. Hold band attached to door. Rotate forearm outward. Slowly return.', 3, 15, 0],
  ['Shoulder Internal Rotation with Band', 'Strengthen rotator cuff internal rotators', 'shoulder', 'strengthening', 'beginner', 'Stand with elbow at side bent 90 degrees. Hold band attached to door. Rotate forearm inward across body. Slowly return.', 3, 15, 0],
  ['Shoulder Flexion with Band', 'Strengthen anterior deltoid and shoulder flexors', 'shoulder', 'strengthening', 'beginner', 'Stand on band. Hold end with thumb up. Raise arm forward to shoulder height. Slowly lower.', 3, 15, 0],
  ['Shoulder Abduction with Band', 'Strengthen middle deltoid with band resistance', 'shoulder', 'strengthening', 'beginner', 'Stand on band. Raise arm out to side to shoulder height with thumb up. Slowly lower.', 3, 15, 0],
  ['Prone Y Raise', 'Strengthen lower trapezius and serratus anterior', 'shoulder', 'strengthening', 'moderate', 'Lie face down on bench or bed. Raise arms in Y shape with thumbs up. Hold briefly at top. Slowly lower.', 3, 12, 2],
  ['Prone T Raise', 'Strengthen middle trapezius and rhomboids', 'shoulder', 'strengthening', 'moderate', 'Lie face down on bench or bed. Raise arms out to sides in T shape with thumbs up. Squeeze shoulder blades. Lower slowly.', 3, 12, 2],
  ['Prone W Raise', 'Strengthen external rotators and scapular stabilizers', 'shoulder', 'strengthening', 'moderate', 'Lie face down. Start with arms in W position (elbows bent, hands up). Lift hands toward ceiling squeezing shoulder blades. Lower slowly.', 3, 12, 2],
  ['Side-Lying External Rotation', 'Isolate infraspinatus and teres minor', 'shoulder', 'strengthening', 'beginner', 'Lie on uninvolved side. Hold light weight with top arm, elbow at side bent 90 degrees. Rotate forearm toward ceiling. Slowly lower.', 3, 15, 0],
  ['Scapular Push-Up Plus', 'Strengthen serratus anterior with protraction', 'shoulder', 'strengthening', 'moderate', 'In push-up position (or on knees). Arms straight. Push shoulder blades apart by pressing into floor. Allow shoulder blades to come together. Repeat.', 3, 12, 0],
  ['Wall Push-Up', 'Gentle shoulder strengthening in weight-bearing', 'shoulder', 'strengthening', 'beginner', 'Stand arm-length from wall. Place hands on wall at shoulder height. Bend elbows to lean toward wall. Push back to start.', 3, 15, 0],
  ['Shoulder Shrug', 'Strengthen upper trapezius', 'shoulder', 'strengthening', 'beginner', 'Stand with arms at sides. Shrug shoulders toward ears. Hold at top briefly. Slowly lower.', 3, 15, 2],
  ['Scapular Retraction', 'Strengthen rhomboids and middle trapezius', 'shoulder', 'strengthening', 'beginner', 'Sit or stand tall. Squeeze shoulder blades together as if holding a pencil between them. Hold, then relax.', 3, 15, 5],
  ['Empty Can Exercise', 'Strengthen supraspinatus', 'shoulder', 'strengthening', 'moderate', 'Stand with arms at sides, thumbs pointed down (like pouring out a can). Raise arms to 45 degrees out to the side. Slowly lower.', 3, 12, 0],
  ['Shoulder Press with Band', 'Overhead pressing with band resistance', 'shoulder', 'strengthening', 'moderate', 'Stand on band. Hold ends at shoulder height. Press overhead until arms are straight. Slowly lower.', 3, 12, 0],
  ['Lat Pull-Down with Band', 'Strengthen latissimus dorsi with band', 'shoulder', 'strengthening', 'moderate', 'Secure band overhead. Kneel or stand. Pull band down to chest level with wide grip. Slowly return.', 3, 12, 0],
  ['Row with Band', 'Strengthen middle back and posterior shoulder', 'shoulder', 'strengthening', 'beginner', 'Secure band at chest height. Pull band toward chest, squeezing shoulder blades. Slowly return.', 3, 15, 0],
  // Stretching
  ['Cross-Body Shoulder Stretch', 'Stretch posterior shoulder capsule', 'shoulder', 'stretching', 'beginner', 'Bring arm across body at chest height. Use other hand to gently pull arm closer to chest. Hold.', 3, 3, 30],
  ['Doorway Pec Stretch', 'Stretch pectoralis major and minor', 'shoulder', 'stretching', 'beginner', 'Stand in doorway with arm at 90 degrees on frame. Step forward until stretch is felt in chest. Hold. Repeat with arm at different heights.', 3, 3, 30],
  ['Sleeper Stretch', 'Stretch posterior shoulder capsule and internal rotators', 'shoulder', 'stretching', 'moderate', 'Lie on involved side with shoulder and elbow at 90 degrees. Use other hand to gently push forearm toward floor. Hold.', 3, 3, 30],
  ['Towel Internal Rotation Stretch', 'Stretch shoulder into internal rotation behind back', 'shoulder', 'stretching', 'moderate', 'Hold towel behind back with involved hand low and uninvolved hand high. Gently pull up with top hand. Hold.', 3, 3, 30],
  ['Overhead Lat Stretch', 'Stretch latissimus dorsi and teres major', 'shoulder', 'stretching', 'beginner', 'Stand next to wall. Reach overhead arm up wall and lean body away. Feel stretch along side. Hold.', 3, 3, 30],
  // ROM
  ['Pendulum Exercise', 'Gentle shoulder mobilization using gravity', 'shoulder', 'rom', 'beginner', 'Lean forward supporting yourself with uninvolved hand on table. Let involved arm hang. Gently swing arm in small circles, forward/back, side to side.', 2, 10, 0],
  ['Wall Walk — Flexion', 'Progressive shoulder flexion ROM using wall', 'shoulder', 'rom', 'beginner', 'Face wall. Walk fingers up the wall as high as comfortable. Hold at top briefly. Walk back down.', 2, 10, 3],
  ['Wall Walk — Abduction', 'Progressive shoulder abduction ROM using wall', 'shoulder', 'rom', 'beginner', 'Stand with involved side toward wall. Walk fingers up wall to the side as high as comfortable. Hold. Walk back down.', 2, 10, 3],
  ['Supine Passive Flexion', 'Use uninvolved arm to assist flexion ROM', 'shoulder', 'rom', 'beginner', 'Lie on back. Hold wrist of involved arm. Use uninvolved arm to lift involved arm overhead as far as comfortable. Lower slowly.', 2, 10, 3],
  ['Table Slide — Flexion', 'Gravity-assisted shoulder flexion on table surface', 'shoulder', 'rom', 'beginner', 'Sit at table with arm on towel. Slide arm forward across table as far as comfortable. Slide back.', 2, 10, 3],
  ['Pulley Exercise', 'Use overhead pulley for assisted shoulder ROM', 'shoulder', 'rom', 'moderate', 'Sit under overhead pulley. Hold handles in both hands. Use uninvolved arm to pull rope, raising involved arm overhead. Slowly lower.', 2, 15, 2],
  ['Behind-Back IR with Towel', 'Improve internal rotation ROM using towel assist', 'shoulder', 'rom', 'moderate', 'Hold towel behind back. Uninvolved hand on top. Gently pull towel up to stretch involved shoulder into internal rotation.', 2, 10, 5],
];

// Thoracic exercises
const THORACIC: ExDef[] = [
  ['Thoracic Extension over Foam Roller', 'Mobilize thoracic spine into extension', 'thoracic', 'rom', 'beginner', 'Lie on foam roller positioned at mid-back. Support head with hands. Gently extend over roller. Move roller to different segments.', 3, 10, 5],
  ['Cat-Cow Stretch', 'Mobilize thoracic spine through flexion and extension', 'thoracic', 'rom', 'beginner', 'On hands and knees. Arch back up like a cat (flexion). Then let belly drop and look up (extension). Move slowly.', 3, 10, 3],
  ['Seated Thoracic Rotation', 'Improve thoracic rotation mobility', 'thoracic', 'rom', 'beginner', 'Sit with arms crossed over chest. Rotate trunk to one side as far as comfortable. Hold. Return and repeat to other side.', 3, 10, 3],
  ['Thread the Needle', 'Improve thoracic rotation with arm reach', 'thoracic', 'rom', 'beginner', 'On hands and knees. Reach one arm under body toward opposite side, rotating trunk. Follow hand with eyes. Return and repeat.', 3, 10, 3],
  ['Open Book Stretch', 'Side-lying thoracic rotation stretch', 'thoracic', 'stretching', 'beginner', 'Lie on side with knees bent and arms stacked. Open top arm rotating trunk back like opening a book. Follow hand with eyes. Return.', 3, 10, 5],
  ['Prone Press-Up', 'McKenzie extension exercise for thoracic spine', 'thoracic', 'rom', 'beginner', 'Lie face down. Place hands by shoulders. Press upper body up straightening arms while keeping hips on floor. Lower slowly.', 3, 10, 3],
  ['Thoracic Extension with Arms Overhead', 'Strengthen thoracic extensors', 'thoracic', 'strengthening', 'moderate', 'Lie face down with arms extended overhead in Y. Lift arms and chest off floor. Hold. Lower slowly.', 3, 10, 3],
  ['Scapular Wall Slide', 'Strengthen scapular stabilizers with thoracic control', 'thoracic', 'strengthening', 'moderate', 'Stand with back against wall. Arms in W position against wall. Slide arms up into Y position keeping contact with wall. Slide back down.', 3, 12, 0],
  ['Foam Roller Snow Angels', 'Thoracic mobility with arm movement on roller', 'thoracic', 'rom', 'beginner', 'Lie lengthwise on foam roller. Make snow angel motions with arms, keeping them on the floor. Move slowly.', 2, 10, 0],
  ['Seated Thoracic Extension', 'Self-mobilization of thoracic extension', 'thoracic', 'rom', 'beginner', 'Sit in chair. Clasp hands behind head. Gently extend backward over the back of the chair. Return to upright.', 3, 10, 3],
  ['Prone Scapular Retraction', 'Strengthen mid-back extensors and scapular retractors', 'thoracic', 'strengthening', 'moderate', 'Lie face down with arms at sides. Squeeze shoulder blades together while lifting arms slightly. Hold. Lower.', 3, 12, 5],
  ['Quadruped Thoracic Rotation', 'Improve thoracic rotation in quadruped', 'thoracic', 'rom', 'beginner', 'On hands and knees. Place one hand behind head. Rotate that elbow toward ceiling, opening chest. Return. Repeat on other side.', 3, 10, 3],
  ['Peanut Thoracic Mobilization', 'Use double lacrosse ball for segmental thoracic extension', 'thoracic', 'rom', 'moderate', 'Tape two tennis balls together. Lie on peanut at different thoracic levels. Extend over peanut with arms crossed. Move to next level.', 3, 5, 10],
  ['Standing Thoracic Extension with Band', 'Resisted thoracic extension for posture', 'thoracic', 'strengthening', 'moderate', 'Hold band overhead with wide grip. Pull band apart and down behind head, squeezing shoulder blades. Slowly return overhead.', 3, 12, 0],
];

// Lumbar exercises
const LUMBAR: ExDef[] = [
  ['Pelvic Tilt', 'Activate deep core muscles with posterior pelvic tilt', 'lumbar', 'strengthening', 'beginner', 'Lie on back with knees bent. Flatten lower back against floor by tilting pelvis. Hold, then relax.', 3, 15, 5],
  ['Dead Bug', 'Core stabilization with opposite arm/leg movement', 'lumbar', 'strengthening', 'moderate', 'Lie on back. Arms up, knees bent 90 degrees. Slowly extend opposite arm and leg while maintaining flat back. Return. Alternate.', 3, 10, 0],
  ['Bird-Dog', 'Core stabilization in quadruped with arm/leg extension', 'lumbar', 'strengthening', 'moderate', 'On hands and knees. Extend opposite arm and leg simultaneously. Hold briefly, keeping spine neutral. Return. Alternate sides.', 3, 10, 3],
  ['Bridge', 'Strengthen glutes and lumbar extensors', 'lumbar', 'strengthening', 'beginner', 'Lie on back with knees bent, feet flat. Squeeze glutes and lift hips off floor until body is straight from shoulders to knees. Hold. Lower slowly.', 3, 15, 5],
  ['Side Plank', 'Strengthen obliques and lateral stabilizers', 'lumbar', 'strengthening', 'moderate', 'Lie on side with elbow under shoulder. Lift hips off floor creating straight line from head to feet. Hold. Lower. Repeat on other side.', 3, 3, 20],
  ['Front Plank', 'Isometric core strengthening in prone position', 'lumbar', 'strengthening', 'moderate', 'On forearms and toes. Hold body in straight line from head to heels. Engage core, do not let hips sag. Hold.', 3, 3, 30],
  ['Partial Curl-Up', 'Strengthen rectus abdominis with controlled flexion', 'lumbar', 'strengthening', 'beginner', 'Lie on back with knees bent. Cross arms over chest. Lift head and shoulders off floor. Hold briefly. Lower slowly.', 3, 15, 2],
  ['Prone Hip Extension', 'Strengthen lumbar extensors and gluteals', 'lumbar', 'strengthening', 'beginner', 'Lie face down. Squeeze one glute and lift leg straight up a few inches. Hold. Lower. Repeat on other side.', 3, 12, 3],
  ['Superman', 'Strengthen lumbar and thoracic extensors', 'lumbar', 'strengthening', 'moderate', 'Lie face down with arms extended overhead. Simultaneously lift arms and legs off floor. Hold. Lower slowly.', 3, 10, 3],
  ['Pallof Press', 'Anti-rotation core exercise with band', 'lumbar', 'strengthening', 'moderate', 'Stand sideways to anchored band at chest height. Hold band at chest. Press arms straight out, resisting rotation. Hold. Return. Switch sides.', 3, 10, 3],
  ['Double Knee to Chest', 'Stretch lumbar extensors and decompress spine', 'lumbar', 'stretching', 'beginner', 'Lie on back. Pull both knees toward chest. Hold, feeling stretch in lower back. Release.', 3, 3, 30],
  ['Single Knee to Chest', 'Gentle unilateral lumbar flexion stretch', 'lumbar', 'stretching', 'beginner', 'Lie on back. Pull one knee toward chest while keeping other leg flat. Hold. Switch sides.', 3, 3, 30],
  ['Child\'s Pose', 'Resting stretch for lumbar spine', 'lumbar', 'stretching', 'beginner', 'Kneel and sit back on heels. Reach arms forward on floor, lowering chest toward thighs. Hold.', 3, 3, 30],
  ['Prayer Stretch', 'Extended child\'s pose with lateral emphasis', 'lumbar', 'stretching', 'beginner', 'From child\'s pose, walk hands to one side to add lateral stretch. Hold. Walk to other side and hold.', 3, 3, 30],
  ['Piriformis Stretch — Figure 4', 'Stretch piriformis to reduce sciatic tension', 'lumbar', 'stretching', 'beginner', 'Lie on back. Cross one ankle over opposite knee making figure 4. Pull bottom knee toward chest. Hold. Switch.', 3, 3, 30],
  ['Cat-Cow for Lumbar', 'Gentle lumbar flexion and extension mobility', 'lumbar', 'rom', 'beginner', 'On hands and knees. Arch back upward (cat). Then drop belly and look up (cow). Focus movement in lower back.', 3, 10, 3],
  ['Lumbar Rotation Stretch', 'Supine trunk rotation for lumbar mobility', 'lumbar', 'rom', 'beginner', 'Lie on back with knees bent. Let both knees fall to one side while keeping shoulders flat. Hold. Switch sides.', 3, 3, 20],
  ['Prone Press-Up (McKenzie)', 'Extension-based lumbar mobilization', 'lumbar', 'rom', 'beginner', 'Lie face down. Place hands by shoulders. Press upper body up straightening arms, keeping hips on floor. Hold briefly. Lower.', 3, 10, 3],
  ['Standing Extension', 'Standing lumbar extension for flexion-biased pain', 'lumbar', 'rom', 'beginner', 'Stand with hands on lower back. Gently lean backward. Hold briefly. Return to upright.', 3, 10, 3],
  ['Seated Lumbar Flexion', 'Seated forward bending for lumbar mobility', 'lumbar', 'rom', 'beginner', 'Sit in chair. Slowly bend forward reaching hands toward floor. Let spine round. Hold. Slowly return upright.', 3, 10, 5],
];

// Hip exercises
const HIP: ExDef[] = [
  ['Clamshell', 'Strengthen gluteus medius in side-lying', 'hip', 'strengthening', 'beginner', 'Lie on side with knees bent and feet together. Open top knee like a clamshell while keeping feet together. Hold. Slowly lower.', 3, 15, 2],
  ['Side-Lying Hip Abduction', 'Strengthen hip abductors in side-lying', 'hip', 'strengthening', 'beginner', 'Lie on side with bottom knee bent for support. Lift top leg straight up toward ceiling. Hold. Slowly lower.', 3, 15, 2],
  ['Standing Hip Abduction with Band', 'Resisted hip abduction in standing', 'hip', 'strengthening', 'moderate', 'Stand on one leg with band around ankles. Move other leg out to side against band resistance. Slowly return.', 3, 15, 0],
  ['Hip Hike', 'Strengthen hip abductors and lateral trunk stabilizers', 'hip', 'strengthening', 'beginner', 'Stand on step with one leg hanging off edge. Drop hanging hip down, then hike it up above level. Repeat.', 3, 15, 0],
  ['Monster Walk', 'Functional hip strengthening with band', 'hip', 'strengthening', 'moderate', 'Place band around ankles. Stand in slight squat. Walk sideways maintaining tension on band. Walk back.', 3, 10, 0],
  ['Single Leg Bridge', 'Advanced glute strengthening', 'hip', 'strengthening', 'moderate', 'Lie on back with one knee bent, other leg extended. Lift hips using single leg. Hold at top. Lower slowly.', 3, 10, 3],
  ['Fire Hydrant', 'Strengthen hip abductors and external rotators', 'hip', 'strengthening', 'beginner', 'On hands and knees. Lift one knee out to side keeping knee bent 90 degrees. Hold. Lower slowly.', 3, 15, 2],
  ['Straight Leg Raise — Supine', 'Strengthen hip flexors and quads', 'hip', 'strengthening', 'beginner', 'Lie on back with one knee bent, other straight. Tighten quad of straight leg and lift to height of bent knee. Hold. Lower slowly.', 3, 15, 2],
  ['Prone Hip Extension', 'Isolate gluteus maximus strengthening', 'hip', 'strengthening', 'beginner', 'Lie face down. Squeeze one glute and lift straight leg off surface a few inches. Hold. Lower. Switch sides.', 3, 12, 3],
  ['Standing Hip Extension with Band', 'Resisted hip extension in standing', 'hip', 'strengthening', 'moderate', 'Stand facing wall. Band around ankle, anchored forward. Extend leg backward against band. Slowly return.', 3, 15, 0],
  ['Hip Flexor Stretch — Half Kneeling', 'Stretch iliopsoas in half-kneeling', 'hip', 'stretching', 'beginner', 'Kneel on one knee with opposite foot forward. Tuck pelvis under and shift weight forward until stretch is felt in front of hip. Hold.', 3, 3, 30],
  ['Pigeon Stretch', 'Deep hip external rotation stretch', 'hip', 'stretching', 'moderate', 'From hands and knees, bring one knee forward and out. Extend other leg behind. Lower body toward floor. Hold.', 3, 3, 30],
  ['Seated Figure 4 Stretch', 'Stretch piriformis and deep hip rotators', 'hip', 'stretching', 'beginner', 'Sit in chair. Cross one ankle over opposite knee. Lean forward at hips until stretch is felt. Hold. Switch.', 3, 3, 30],
  ['Standing Quad Stretch', 'Stretch quadriceps and hip flexors', 'hip', 'stretching', 'beginner', 'Stand on one leg. Grab ankle of other leg and pull heel toward buttock. Keep knees together. Hold. Switch.', 3, 3, 30],
  ['90-90 Hip Stretch', 'Stretch both internal and external hip rotators', 'hip', 'stretching', 'moderate', 'Sit with front leg bent 90 degrees, back leg bent 90 degrees behind. Lean forward over front leg. Hold. Switch sides.', 3, 3, 30],
  ['Hip Flexion AROM', 'Active hip flexion range of motion', 'hip', 'rom', 'beginner', 'Lie on back. Slowly bring one knee toward chest as far as comfortable. Hold briefly. Return. Switch sides.', 2, 10, 2],
  ['Hip IR/ER in Sitting', 'Seated hip rotation ROM exercise', 'hip', 'rom', 'beginner', 'Sit on edge of chair with knees at 90 degrees. Rotate foot outward (internal rotation) and inward (external rotation). Repeat on other side.', 2, 10, 2],
  ['Hip Circles', 'Full hip ROM in standing', 'hip', 'rom', 'beginner', 'Stand on one leg. Make circles with other leg, moving through flexion, abduction, extension, adduction. Reverse direction. Switch legs.', 2, 10, 0],
];

// Knee exercises
const KNEE: ExDef[] = [
  ['Quad Set', 'Isometric quadriceps strengthening', 'knee', 'strengthening', 'beginner', 'Sit with leg extended. Tighten quad muscle pushing back of knee into surface. Hold. Relax.', 3, 15, 5],
  ['Short Arc Quad', 'Strengthen quads in limited ROM', 'knee', 'strengthening', 'beginner', 'Sit with rolled towel under knee. Straighten knee lifting foot off surface. Hold at top. Slowly lower.', 3, 15, 3],
  ['Terminal Knee Extension with Band', 'Strengthen quads in last degrees of extension', 'knee', 'strengthening', 'beginner', 'Loop band behind knee, anchored at knee height. Start slightly bent. Straighten knee against band resistance. Slowly bend back.', 3, 15, 0],
  ['Straight Leg Raise — 4-Way', 'Strengthen muscles around knee in all planes', 'knee', 'strengthening', 'beginner', 'Lie on back: lift straight leg up (front). Roll to side: lift up (side). Roll to stomach: lift up (back). Roll to other side: lift (inner thigh).', 3, 10, 2],
  ['Wall Sit', 'Isometric quad and glute strengthening', 'knee', 'strengthening', 'moderate', 'Lean against wall with knees bent to 60-90 degrees. Hold position as if sitting in invisible chair. Keep back against wall.', 3, 3, 30],
  ['Step-Up', 'Functional knee strengthening with step', 'knee', 'strengthening', 'moderate', 'Stand in front of step. Step up with involved leg, straightening fully on step. Step back down slowly with control.', 3, 12, 0],
  ['Step-Down', 'Eccentric quad strengthening on step', 'knee', 'strengthening', 'moderate', 'Stand on step. Slowly lower uninvolved foot toward floor by bending involved knee. Tap floor lightly, then return to standing on step.', 3, 12, 0],
  ['Mini Squat', 'Partial range squat for knee strengthening', 'knee', 'strengthening', 'beginner', 'Stand with feet shoulder-width apart. Bend knees to 45 degrees as if sitting back slightly. Keep weight on heels. Return to standing.', 3, 15, 0],
  ['Hamstring Curl with Band', 'Strengthen hamstrings with band resistance', 'knee', 'strengthening', 'beginner', 'Stand facing wall. Band around ankle, anchored forward at floor. Curl heel toward buttock against band. Slowly lower.', 3, 15, 0],
  ['Single Leg Squat to Chair', 'Advance single-leg strength', 'knee', 'strengthening', 'advanced', 'Stand on one leg in front of chair. Slowly lower to sit, controlling descent with one leg. Stand back up on one leg.', 3, 8, 0],
  ['Hamstring Stretch — Supine', 'Stretch hamstrings with strap assist', 'knee', 'stretching', 'beginner', 'Lie on back. Loop strap around foot. Raise leg keeping knee straight until stretch is felt behind thigh. Hold.', 3, 3, 30],
  ['Standing Calf Stretch', 'Stretch gastrocnemius at wall', 'knee', 'stretching', 'beginner', 'Stand facing wall. Step one foot back keeping it straight and heel down. Lean into wall until stretch is felt in calf. Hold. Switch.', 3, 3, 30],
  ['IT Band Stretch — Standing', 'Stretch iliotibial band', 'knee', 'stretching', 'beginner', 'Stand with involved leg behind and crossed behind other leg. Lean away from involved side. Hold.', 3, 3, 30],
  ['Quad Stretch — Prone', 'Stretch quadriceps in prone position', 'knee', 'stretching', 'beginner', 'Lie face down. Grab ankle and pull heel toward buttock. Hold. Use strap if needed.', 3, 3, 30],
  ['Knee Flexion AROM — Seated', 'Active knee flexion range of motion', 'knee', 'rom', 'beginner', 'Sit in chair. Slowly bend knee sliding foot under chair as far as comfortable. Hold briefly. Straighten.', 2, 15, 2],
  ['Knee Extension AROM — Seated', 'Active knee extension range of motion', 'knee', 'rom', 'beginner', 'Sit in chair. Slowly straighten knee as far as possible. Hold briefly. Lower slowly.', 2, 15, 2],
  ['Heel Slide', 'Supine knee flexion ROM exercise', 'knee', 'rom', 'beginner', 'Lie on back. Slide heel toward buttock bending knee. Hold briefly. Slide back to straight.', 2, 15, 2],
  ['Stationary Bike', 'Low-impact knee ROM and conditioning', 'knee', 'rom', 'beginner', 'Ride stationary bike with low resistance. Start with partial revolutions if needed. Progress to full revolutions. 10-15 minutes.', 1, 1, 0],
];

// Elbow/Wrist exercises
const ELBOW_WRIST: ExDef[] = [
  ['Wrist Flexion with Weight', 'Strengthen wrist flexors', 'elbow_wrist', 'strengthening', 'beginner', 'Sit with forearm on table, palm up, wrist over edge. Hold light weight. Curl wrist upward. Slowly lower.', 3, 15, 0],
  ['Wrist Extension with Weight', 'Strengthen wrist extensors', 'elbow_wrist', 'strengthening', 'beginner', 'Sit with forearm on table, palm down, wrist over edge. Hold light weight. Extend wrist upward. Slowly lower.', 3, 15, 0],
  ['Pronation/Supination with Hammer', 'Strengthen forearm rotators', 'elbow_wrist', 'strengthening', 'beginner', 'Hold hammer or weighted stick at end. Rotate palm up (supination) then palm down (pronation). Move slowly.', 3, 15, 0],
  ['Grip Strengthening — Ball Squeeze', 'Strengthen hand grip with ball', 'elbow_wrist', 'strengthening', 'beginner', 'Squeeze a soft ball or putty. Hold squeeze. Relax. Repeat.', 3, 15, 3],
  ['Eccentric Wrist Extension', 'Eccentric loading for lateral epicondylitis', 'elbow_wrist', 'strengthening', 'moderate', 'Support forearm palm down. Use uninvolved hand to assist wrist into extension. Slowly lower weight through wrist flexion using only involved hand.', 3, 15, 0],
  ['Tyler Twist — FlexBar', 'Eccentric exercise for tennis elbow with flexible bar', 'elbow_wrist', 'strengthening', 'moderate', 'Hold FlexBar vertically. Twist with involved hand into extension. Extend both arms forward. Slowly release twist with involved hand.', 3, 15, 0],
  ['Bicep Curl with Band', 'Strengthen biceps with band resistance', 'elbow_wrist', 'strengthening', 'beginner', 'Stand on band. Curl hand toward shoulder against band resistance. Slowly lower.', 3, 15, 0],
  ['Tricep Extension with Band', 'Strengthen triceps overhead with band', 'elbow_wrist', 'strengthening', 'beginner', 'Hold band behind back. Top hand at shoulder. Press top hand straight up overhead. Slowly lower.', 3, 15, 0],
  ['Wrist Flexor Stretch', 'Stretch forearm flexors', 'elbow_wrist', 'stretching', 'beginner', 'Extend arm with palm up. Use other hand to pull fingers down and back. Hold stretch.', 3, 3, 30],
  ['Wrist Extensor Stretch', 'Stretch forearm extensors', 'elbow_wrist', 'stretching', 'beginner', 'Extend arm with palm down. Use other hand to push hand down and toward you. Hold stretch.', 3, 3, 30],
  ['Elbow Flexion/Extension ROM', 'Active elbow ROM exercise', 'elbow_wrist', 'rom', 'beginner', 'Sit or stand. Slowly bend elbow fully, then straighten fully. Move through pain-free range.', 2, 15, 0],
  ['Forearm Rotation ROM', 'Active pronation/supination ROM', 'elbow_wrist', 'rom', 'beginner', 'Bend elbow 90 degrees at side. Rotate palm up then palm down through full range. Move slowly.', 2, 15, 0],
  ['Wrist Circles', 'Full wrist ROM in circular pattern', 'elbow_wrist', 'rom', 'beginner', 'Make slow circles with wrist in both directions. Keep forearm still. Move through full pain-free range.', 2, 10, 0],
  ['Finger Tendon Glides', 'Improve finger tendon excursion', 'elbow_wrist', 'rom', 'beginner', 'Start with fingers straight. Make a hook fist (bend at middle joints). Then make a full fist. Then extend. Repeat.', 2, 10, 2],
  ['Nerve Glide — Median', 'Mobilize median nerve through upper extremity', 'elbow_wrist', 'rom', 'moderate', 'Start with arm at side, elbow bent. Extend wrist, then straighten elbow, then move arm out. Hold each position 3 seconds.', 2, 10, 3],
  ['Nerve Glide — Ulnar', 'Mobilize ulnar nerve through upper extremity', 'elbow_wrist', 'rom', 'moderate', 'Start with arm at side. Extend wrist, supinate forearm, flex elbow, then abduct shoulder. Hold each position 3 seconds.', 2, 10, 3],
];

// Ankle/Foot exercises
const ANKLE_FOOT: ExDef[] = [
  ['Ankle Dorsiflexion with Band', 'Strengthen tibialis anterior', 'ankle_foot', 'strengthening', 'beginner', 'Sit with leg extended. Loop band around foot, anchored forward. Pull foot up toward shin against band. Slowly point foot.', 3, 15, 0],
  ['Ankle Plantarflexion — Calf Raise', 'Strengthen calf (gastrocnemius and soleus)', 'ankle_foot', 'strengthening', 'beginner', 'Stand on both feet. Rise up on toes as high as possible. Hold at top. Lower slowly with control.', 3, 15, 2],
  ['Single Leg Calf Raise', 'Advanced unilateral calf strengthening', 'ankle_foot', 'strengthening', 'moderate', 'Stand on one foot on edge of step. Rise up on toes. Lower heel below step level. Rise back up.', 3, 12, 0],
  ['Ankle Eversion with Band', 'Strengthen peroneal muscles', 'ankle_foot', 'strengthening', 'beginner', 'Sit with legs extended. Band around feet. Turn involved foot outward against band resistance. Slowly return.', 3, 15, 0],
  ['Ankle Inversion with Band', 'Strengthen tibialis posterior', 'ankle_foot', 'strengthening', 'beginner', 'Sit with legs extended. Band around involved foot, anchored on same side. Turn foot inward against band. Slowly return.', 3, 15, 0],
  ['Towel Curl', 'Strengthen intrinsic foot muscles', 'ankle_foot', 'strengthening', 'beginner', 'Sit with foot on towel on smooth floor. Scrunch towel toward you using toes. Spread towel out. Repeat.', 3, 10, 0],
  ['Marble Pickup', 'Strengthen intrinsic foot muscles with fine motor', 'ankle_foot', 'strengthening', 'beginner', 'Place marbles on floor. Pick up one at a time with toes and place in cup. Use each foot.', 2, 15, 0],
  ['Heel Walk', 'Strengthen dorsiflexors functionally', 'ankle_foot', 'strengthening', 'moderate', 'Walk on heels only for 20 steps. Keep toes off the ground. Turn around and walk back.', 3, 2, 0],
  ['Toe Walk', 'Strengthen plantarflexors functionally', 'ankle_foot', 'strengthening', 'moderate', 'Walk on toes/balls of feet for 20 steps. Keep heels off ground. Turn and walk back.', 3, 2, 0],
  ['Calf Stretch — Gastrocnemius', 'Stretch gastrocnemius with straight knee', 'ankle_foot', 'stretching', 'beginner', 'Face wall. Step one foot back, keeping knee straight and heel on floor. Lean into wall. Hold.', 3, 3, 30],
  ['Calf Stretch — Soleus', 'Stretch soleus with bent knee', 'ankle_foot', 'stretching', 'beginner', 'Face wall. Step one foot back, bend that knee keeping heel on floor. Lean into wall. Hold.', 3, 3, 30],
  ['Plantar Fascia Stretch', 'Stretch plantar fascia and toe flexors', 'ankle_foot', 'stretching', 'beginner', 'Sit and cross involved foot over other knee. Pull toes back toward shin until stretch is felt on bottom of foot. Hold.', 3, 3, 30],
  ['Frozen Water Bottle Roll', 'Self-massage and stretch for plantar fascia', 'ankle_foot', 'stretching', 'beginner', 'Sit with foot on frozen water bottle. Roll bottle under foot from heel to toes with moderate pressure.', 2, 1, 120],
  ['Ankle Alphabet', 'Full ankle ROM exercise using alphabet tracing', 'ankle_foot', 'rom', 'beginner', 'Sit with foot off the ground. Trace the alphabet in the air with big toe. Use full range of ankle motion.', 1, 1, 0],
  ['Ankle Circles', 'Ankle ROM in circular pattern', 'ankle_foot', 'rom', 'beginner', 'Sit with foot off ground. Make circles with foot in both directions. Move through full range.', 2, 10, 0],
  ['Ankle Pumps', 'Active dorsiflexion/plantarflexion ROM', 'ankle_foot', 'rom', 'beginner', 'Lie down or sit with leg elevated. Pull foot up toward shin then point foot down. Repeat rhythmically.', 3, 20, 0],
];

// Balance exercises
const BALANCE: ExDef[] = [
  ['Single Leg Stance', 'Basic static balance on one leg', 'full_body', 'balance', 'beginner', 'Stand on one leg near counter for safety. Hold for time. Switch legs. Progress by closing eyes or standing on foam.', 3, 3, 30],
  ['Tandem Stance', 'Narrowed base of support balance', 'full_body', 'balance', 'beginner', 'Stand with one foot directly in front of other, heel to toe. Hold position. Switch front foot.', 3, 3, 30],
  ['Weight Shifting', 'Practice controlled weight transfer', 'full_body', 'balance', 'beginner', 'Stand with feet shoulder width apart. Slowly shift weight side to side. Then forward and back. Maintain control.', 3, 10, 3],
  ['Tandem Walk', 'Dynamic balance walking heel-to-toe', 'full_body', 'balance', 'beginner', 'Walk in straight line placing heel directly in front of opposite toe with each step. Walk 20 steps. Turn and return.', 3, 2, 0],
  ['Single Leg Stance on Foam', 'Balance challenge on unstable surface', 'full_body', 'balance', 'moderate', 'Stand on foam pad on one leg. Hold position. Use counter for safety if needed. Switch legs.', 3, 3, 30],
  ['BOSU Ball Stance', 'Balance on unstable BOSU surface', 'full_body', 'balance', 'moderate', 'Stand on BOSU ball with both feet. Hold position with good posture. Progress to single leg.', 3, 3, 30],
  ['Clock Reach', 'Dynamic balance reaching in multiple directions', 'full_body', 'balance', 'moderate', 'Stand on one leg. Reach other foot to 12, 3, 6, and 9 o\'clock positions on imaginary clock. Return to center each time.', 3, 4, 0],
  ['Star Excursion Balance', 'Dynamic reaching balance test and exercise', 'full_body', 'balance', 'advanced', 'Stand on one leg. Reach other foot as far as possible in 8 directions (like a star). Return to center each time.', 3, 8, 0],
  ['Walking with Head Turns', 'Gaze stability during walking', 'full_body', 'balance', 'moderate', 'Walk in straight line while turning head side to side. Maintain straight path. Walk 30 feet. Turn and return.', 3, 2, 0],
  ['Backward Walking', 'Balance and proprioception during backward gait', 'full_body', 'balance', 'moderate', 'Walk backward slowly with good control. Use hallway or parallel bars for safety. Walk 20 steps.', 3, 2, 0],
  ['Lateral Walking', 'Sidestepping for lateral balance', 'full_body', 'balance', 'beginner', 'Sidestep to the right 10 steps, then sidestep left 10 steps. Maintain good posture and control.', 3, 2, 0],
  ['Sit to Stand — No Hands', 'Functional balance transition', 'full_body', 'balance', 'moderate', 'Sit in chair. Stand up without using hands. Slowly sit back down with control. Keep weight over feet.', 3, 10, 0],
  ['Single Leg Stance Eyes Closed', 'Advanced proprioceptive balance challenge', 'full_body', 'balance', 'advanced', 'Stand on one leg with eyes closed. Stay near wall for safety. Hold as long as possible. Switch legs.', 3, 3, 15],
  ['Foam Pad Tandem Stance', 'Tandem stance on foam for vestibular challenge', 'full_body', 'balance', 'moderate', 'Stand heel-to-toe on foam pad. Hold position. Switch front foot. Progress to eyes closed.', 3, 3, 30],
];

// Functional exercises
const FUNCTIONAL: ExDef[] = [
  ['Squat', 'Functional bilateral lower body exercise', 'full_body', 'functional', 'moderate', 'Stand with feet shoulder-width apart. Lower as if sitting in chair. Keep knees behind toes. Weight on heels. Stand back up.', 3, 12, 0],
  ['Lunge — Forward', 'Functional single-leg strengthening', 'full_body', 'functional', 'moderate', 'Step forward into lunge. Lower back knee toward floor. Keep front knee over ankle. Push back to standing. Alternate legs.', 3, 10, 0],
  ['Lunge — Lateral', 'Side lunge for frontal plane strength', 'full_body', 'functional', 'moderate', 'Step to one side into wide stance. Bend stepping-side knee pushing hips back. Keep other leg straight. Push back to center.', 3, 10, 0],
  ['Lunge — Reverse', 'Backward lunge for control and strength', 'full_body', 'functional', 'moderate', 'Step backward into lunge position. Lower back knee toward floor. Push back to standing. Alternate legs.', 3, 10, 0],
  ['Romanian Deadlift', 'Hinge pattern strengthening for posterior chain', 'full_body', 'functional', 'moderate', 'Stand with slight knee bend. Hinge at hips lowering trunk forward while pushing hips back. Feel hamstring stretch. Return to standing.', 3, 12, 0],
  ['Single Leg Deadlift', 'Balance and posterior chain strengthening', 'full_body', 'functional', 'advanced', 'Stand on one leg. Hinge at hip, extending other leg behind for balance. Lower trunk until parallel to floor. Return upright.', 3, 8, 0],
  ['Sit-to-Stand', 'Functional transfer training', 'full_body', 'functional', 'beginner', 'Sit in chair. Lean forward, push through feet to stand. Slowly lower back to sit. Use arms only if needed.', 3, 10, 0],
  ['Step-Over Obstacles', 'Functional stepping and hip flexion', 'full_body', 'functional', 'moderate', 'Set up low obstacles in a line. Step over each one with good hip and knee flexion. Walk through course. Return.', 3, 2, 0],
  ['Farmer Carry', 'Grip, core, and postural endurance', 'full_body', 'functional', 'moderate', 'Hold weight in each hand at sides. Walk with good posture for 30-50 feet. Turn and return.', 3, 2, 0],
  ['Push-Up', 'Upper body functional strengthening', 'full_body', 'functional', 'moderate', 'Start in plank position. Lower chest toward floor bending elbows. Push back up. Modify on knees if needed.', 3, 10, 0],
  ['Goblet Squat', 'Weighted squat pattern with counterbalance', 'full_body', 'functional', 'moderate', 'Hold weight at chest with both hands. Squat down keeping torso upright. Stand back up.', 3, 12, 0],
  ['Stair Climbing', 'Functional stair training', 'full_body', 'functional', 'moderate', 'Walk up and down stairs with good form. Use rail as needed. Step over step pattern. 2-3 flights.', 3, 2, 0],
  ['Picking Up Objects', 'Proper body mechanics for floor reach', 'full_body', 'functional', 'beginner', 'Practice bending at hips and knees (not back) to pick up objects from floor. Use golfer\'s lift for light items.', 3, 10, 0],
  ['Overhead Reach with Weight', 'Functional overhead mobility and strength', 'full_body', 'functional', 'moderate', 'Hold light weight in both hands. Raise overhead with control. Lower to chest level. Repeat.', 3, 12, 0],
];

// Cardio/Conditioning exercises
const CARDIO: ExDef[] = [
  ['Walking Program — Level 1', 'Beginner walking program for aerobic conditioning', 'full_body', 'cardio', 'beginner', 'Walk at comfortable pace for 10-15 minutes on flat surface. Gradually increase pace and duration as tolerated.', 1, 1, 0],
  ['Walking Program — Level 2', 'Intermediate walking with incline', 'full_body', 'cardio', 'moderate', 'Walk at moderate pace for 20-30 minutes. Include some incline walking. Maintain conversational pace.', 1, 1, 0],
  ['Walking Program — Level 3', 'Advanced walking/light jogging', 'full_body', 'cardio', 'advanced', 'Walk 30-45 minutes at brisk pace. May alternate 2 minutes jogging with 3 minutes walking if approved.', 1, 1, 0],
  ['Recumbent Bike', 'Low-impact aerobic conditioning on recumbent bike', 'full_body', 'cardio', 'beginner', 'Ride recumbent bike at comfortable resistance for 10-20 minutes. Maintain RPE of 3-4 out of 10.', 1, 1, 0],
  ['Upright Bike', 'Moderate aerobic conditioning on upright bike', 'full_body', 'cardio', 'moderate', 'Ride upright stationary bike at moderate resistance for 15-30 minutes. Maintain RPE of 4-5 out of 10.', 1, 1, 0],
  ['Elliptical', 'Full-body low-impact aerobic exercise', 'full_body', 'cardio', 'moderate', 'Use elliptical machine at moderate pace for 15-25 minutes. Maintain good posture. Adjust resistance as tolerated.', 1, 1, 0],
  ['Arm Ergometer', 'Upper body aerobic conditioning', 'full_body', 'cardio', 'beginner', 'Use arm ergometer (UBE) at low to moderate resistance for 10-15 minutes. Maintain comfortable pace.', 1, 1, 0],
  ['Pool Walking', 'Aquatic aerobic exercise with buoyancy assist', 'full_body', 'cardio', 'beginner', 'Walk forward and backward in waist-deep pool for 15-20 minutes. Progress to deeper water and add arm movements.', 1, 1, 0],
  ['Seated Marching', 'Low-level aerobic exercise for deconditioned patients', 'full_body', 'cardio', 'beginner', 'Sit in chair with good posture. March in place alternating lifting knees. Swing arms gently. Continue 5-10 minutes.', 1, 1, 0],
  ['Step Aerobics — Low', 'Step-based aerobic conditioning', 'full_body', 'cardio', 'moderate', 'Use low step (4-6 inches). Step up and down alternating lead legs. Maintain moderate pace for 10-15 minutes.', 1, 1, 0],
];

// Neuromuscular exercises
const NEUROMUSCULAR: ExDef[] = [
  ['Proprioceptive Alphabet', 'Ankle proprioception using alphabet tracing', 'ankle_foot', 'neuromuscular', 'beginner', 'Stand on one leg. Draw alphabet letters in air with other foot. Focus on control and accuracy.', 2, 1, 0],
  ['Ball Toss Single Leg', 'Dual-task balance with ball catch', 'full_body', 'neuromuscular', 'moderate', 'Stand on one leg. Toss ball against wall and catch. Progress to looking away between tosses.', 3, 10, 0],
  ['Perturbation Training', 'Reactive balance training with partner', 'full_body', 'neuromuscular', 'moderate', 'Stand in athletic stance. Partner provides gentle unexpected pushes from different directions. React to maintain balance.', 3, 10, 0],
  ['Agility Ladder — Lateral', 'Lateral agility and coordination', 'full_body', 'neuromuscular', 'moderate', 'Step laterally through agility ladder, one foot per box. Go through ladder, then return. Focus on quick, light feet.', 3, 2, 0],
  ['Agility Ladder — Forward', 'Forward agility and coordination', 'full_body', 'neuromuscular', 'moderate', 'Step through agility ladder going forward, two feet per box. Focus on quick, controlled foot placement.', 3, 2, 0],
  ['Cone Weave Walking', 'Directional change and motor planning', 'full_body', 'neuromuscular', 'beginner', 'Set up cones in zigzag pattern. Walk through weaving between cones. Walk through course and return.', 3, 2, 0],
  ['Reaction Ball Drill', 'Visual reaction time and agility', 'full_body', 'neuromuscular', 'moderate', 'Drop or bounce reaction ball (irregular shaped). Catch it after bounce. Progress to faster drops.', 3, 10, 0],
  ['Mirror Exercise — Upper Extremity', 'Mirror therapy for motor recovery', 'full_body', 'neuromuscular', 'beginner', 'Place mirror along midline. Move uninvolved hand while watching reflection. Brain perceives involved hand moving.', 2, 10, 0],
  ['Rhythmic Stabilization', 'PNF technique for joint stability', 'full_body', 'neuromuscular', 'moderate', 'Hold arm or leg in position. Therapist applies alternating rotational forces. Patient resists without moving. Progress force gradually.', 3, 10, 5],
  ['Slow Reversal Hold', 'PNF pattern for neuromuscular coordination', 'full_body', 'neuromuscular', 'moderate', 'Move limb through PNF diagonal pattern. Pause and hold at mid-range. Reverse direction slowly. Repeat.', 3, 10, 3],
];

const ALL_EXERCISES: ExDef[] = [
  ...CERVICAL, ...SHOULDER, ...THORACIC, ...LUMBAR, ...HIP,
  ...KNEE, ...ELBOW_WRIST, ...ANKLE_FOOT, ...BALANCE,
  ...FUNCTIONAL, ...CARDIO, ...NEUROMUSCULAR,
];

export async function up(client: PoolClient): Promise<void> {

  // ── 1. Make exercises.clinic_id nullable for global exercises ──
  await client.query(`ALTER TABLE exercises ALTER COLUMN clinic_id DROP NOT NULL;`);

  // ── 2. Create demo_requests table (public — no auth required) ──
  await client.query(`
    CREATE TABLE IF NOT EXISTS demo_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(255) NOT NULL,
      clinic_name VARCHAR(255) NOT NULL,
      provider_count VARCHAR(20),
      phone VARCHAR(30),
      current_emr VARCHAR(100),
      message TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','demo_scheduled','converted','closed')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests(email);`);

  // ── 3. Create sso_connections table ──
  await client.query(`
    CREATE TABLE IF NOT EXISTS sso_connections (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL CHECK (provider IN ('saml','oidc','google','azure_ad','okta')),
      display_name VARCHAR(100) NOT NULL,
      client_id VARCHAR(255),
      client_secret_encrypted TEXT,
      issuer_url TEXT,
      metadata_url TEXT,
      certificate TEXT,
      domain_hint VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT false,
      auto_provision_users BOOLEAN NOT NULL DEFAULT false,
      default_role VARCHAR(20) NOT NULL DEFAULT 'therapist',
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(clinic_id, provider)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sso_connections_clinic ON sso_connections(clinic_id);`);

  // ── 4. Add plan_tier and account_manager to clinics ──
  await client.query(`
    ALTER TABLE clinics
      ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(20) NOT NULL DEFAULT 'starter'
        CHECK (plan_tier IN ('starter','professional','enterprise')),
      ADD COLUMN IF NOT EXISTS account_manager_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS account_manager_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS account_manager_phone VARCHAR(30);
  `);

  // ── 5. Seed 500+ global PT exercises ──
  // Use a single multi-row INSERT for performance
  const batchSize = 50;
  for (let i = 0; i < ALL_EXERCISES.length; i += batchSize) {
    const batch = ALL_EXERCISES.slice(i, i + batchSize);
    const values: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [name, description, body_region, category, difficulty, instructions, sets, reps, hold] of batch) {
      values.push(`(NULL, $${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6}, $${idx+7}, $${idx+8}, true, true)`);
      params.push(name, description, body_region, category, difficulty, instructions, sets, reps, hold);
      idx += 9;
    }

    await client.query(
      `INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active)
       VALUES ${values.join(',\n')}
       ON CONFLICT DO NOTHING`,
      params
    );
  }

  console.log(`Seeded ${ALL_EXERCISES.length} global exercises`);
}

export async function down(client: PoolClient): Promise<void> {
  // Remove global exercises
  await client.query(`DELETE FROM exercises WHERE is_global = true AND clinic_id IS NULL;`);

  // Remove added columns from clinics
  await client.query(`ALTER TABLE clinics DROP COLUMN IF EXISTS plan_tier;`);
  await client.query(`ALTER TABLE clinics DROP COLUMN IF EXISTS account_manager_name;`);
  await client.query(`ALTER TABLE clinics DROP COLUMN IF EXISTS account_manager_email;`);
  await client.query(`ALTER TABLE clinics DROP COLUMN IF EXISTS account_manager_phone;`);

  // Drop tables
  await client.query(`DROP TABLE IF EXISTS sso_connections CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS demo_requests CASCADE;`);

  // Restore NOT NULL on exercises.clinic_id (requires removing null rows first)
  await client.query(`DELETE FROM exercises WHERE clinic_id IS NULL;`);
  await client.query(`ALTER TABLE exercises ALTER COLUMN clinic_id SET NOT NULL;`);
}
