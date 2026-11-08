// UK outdoor bouldering areas.
//
// Crag and parking coordinates are taken from OpenStreetMap (checked Nov 2026) and parking details change —
// always check access notes (e.g. BMC RAD: https://www.thebmc.co.uk/rad) before you go.
//
// Fields:
//   id, name, region, lat, lng      – crag location
//   rock                            – rock type
//   grades                          – rough Font grade range
//   approach                        – walk-in time from the main parking
//   description                     – short summary
//   parking[]                       – { name, lat, lng, notes, fee }
//   photos[]                        – optional { url, credit } to pin specific images;
//                                     otherwise photos are pulled from Wikimedia Commons

export const AREAS = [
  {
    id: "stanage-plantation",
    name: "Stanage Plantation",
    region: "Peak District",
    lat: 53.354, lng: -1.6385,
    rock: "Gritstone",
    grades: "f3 – f8A",
    approach: "15 min",
    description:
      "Dense cluster of classic grit blocks below the edge, including the Pebble and the Grand Hotel. Superb landings and a huge spread of grades.",
    parking: [
      { name: "Hollin Bank car park", lat: 53.3504, lng: -1.645, notes: "Main car park for the Plantation, ~10 min walk up through the wood. Busy at weekends.", fee: "Pay & display" },
      { name: "Roadside parking, Dennis Knoll", lat: 53.3548, lng: -1.6515, notes: "Free roadside spaces further west; don't block gates or passing places.", fee: "Free" },
    ],
  },
  {
    id: "burbage-north",
    name: "Burbage North",
    region: "Peak District",
    lat: 53.339, lng: -1.602,
    rock: "Gritstone",
    grades: "f3 – f7B",
    approach: "5 min",
    description:
      "Short, friendly edge and boulders right by the road. Great for beginners and quick evening sessions.",
    parking: [
      { name: "Upper Burbage Bridge (west)", lat: 53.3428, lng: -1.6079, notes: "Roadside spaces by the bridge at the north end of the edge.", fee: "Free" },
      { name: "Upper Burbage Bridge (east)", lat: 53.3433, lng: -1.5995, notes: "More spaces along the road towards Ringinglow.", fee: "Free" },
    ],
  },
  {
    id: "burbage-south",
    name: "Burbage South Valley",
    region: "Peak District",
    lat: 53.327, lng: -1.61,
    rock: "Gritstone",
    grades: "f4 – f8A+",
    approach: "15–20 min",
    description:
      "Scattered blocks below Burbage South edge and around the Cioch, plus the famous Burbage South boulders. Quieter than Stanage.",
    parking: [
      { name: "Lay-by, Hathersage Road (A6187)", lat: 53.3214, lng: -1.6068, notes: "Roadside parking near the Toad's Mouth; walk north up the valley.", fee: "Free" },
      { name: "Upper Burbage Bridge", lat: 53.3428, lng: -1.6079, notes: "Alternative from the north; longer walk down the valley track.", fee: "Free" },
    ],
  },
  {
    id: "curbar",
    name: "Curbar Edge",
    region: "Peak District",
    lat: 53.2751, lng: -1.6173,
    rock: "Gritstone",
    grades: "f4 – f8A",
    approach: "10 min",
    description:
      "Below-edge boulders and the Trackside blocks. Strong, steep problems with a few highballs.",
    parking: [
      { name: "Curbar Gap car park", lat: 53.269, lng: -1.6081, notes: "Eastern Moors car park at the top of the gap; walk north along the edge.", fee: "Pay & display" },
      { name: "Roadside, Curbar Gap", lat: 53.2695, lng: -1.6133, notes: "Limited roadside spaces just below the gap.", fee: "Free" },
    ],
  },
  {
    id: "froggatt",
    name: "Froggatt Edge",
    region: "Peak District",
    lat: 53.2848, lng: -1.6285,
    rock: "Gritstone",
    grades: "f3 – f7C",
    approach: "15 min",
    description:
      "Pleasant woodland approach to slabby boulders and the Froggatt Pinnacle area.",
    parking: [
      { name: "Roadside parking, south end", lat: 53.2794, lng: -1.6309, notes: "Spaces by the road between Curbar and Froggatt; walk north along the edge.", fee: "Free" },
      { name: "Froggatt car parking (near the Grouse Inn)", lat: 53.294, lng: -1.6186, notes: "North end; woodland approach to the edge.", fee: "Free" },
    ],
  },
  {
    id: "the-roaches",
    name: "The Roaches",
    region: "Peak District (Staffordshire)",
    lat: 53.164, lng: -2.0,
    rock: "Gritstone",
    grades: "f3 – f8B",
    approach: "15 min",
    description:
      "Wild, sandy grit with the Lower Tier boulders, Skyline and Roaches Bloc. Beautiful views over Tittesworth.",
    parking: [
      { name: "Roaches Road lay-bys", lat: 53.1578, lng: -1.9982, notes: "Roadside lay-bys below the crag. The road is sometimes closed at busy weekends.", fee: "Free" },
      { name: "Further Roaches Road lay-bys", lat: 53.1559, lng: -1.9949, notes: "Overflow spaces a little further along the road.", fee: "Free" },
    ],
  },
  {
    id: "almscliff",
    name: "Almscliff",
    region: "Yorkshire",
    lat: 53.9355, lng: -1.597,
    rock: "Gritstone",
    grades: "f3 – f8A",
    approach: "5 min",
    description:
      "A lone grit outcrop with a rich history. Burly, technical problems and the classic Low Man circuit.",
    parking: [
      { name: "Crag Lane roadside", lat: 53.9372, lng: -1.597, notes: "Roadside spaces on the lane north of the crag; short walk across the field.", fee: "Free" },
    ],
  },
  {
    id: "caley",
    name: "Caley Crags",
    region: "Yorkshire",
    lat: 53.8962, lng: -1.65,
    rock: "Gritstone",
    grades: "f3 – f8A",
    approach: "10 min",
    description:
      "Woodland boulders above the A660 with brilliant roof and arête problems, including the Sugarloaf and Roadside boulders.",
    parking: [
      { name: "Car park off Pool Road (East Chevin)", lat: 53.9043, lng: -1.6427, notes: "Mapped car park ~1 km from the crags. There's also limited roadside parking on the A660 below the crag.", fee: "Free" },
    ],
  },
  {
    id: "brimham",
    name: "Brimham Rocks",
    region: "Yorkshire",
    lat: 54.0804, lng: -1.6849,
    rock: "Gritstone",
    grades: "f3 – f7C",
    approach: "5 min",
    description:
      "Weird and wonderful wind-sculpted towers on a National Trust estate. Endless low-grade fun and some stiff test-pieces.",
    parking: [
      { name: "Brimham Rocks car park (National Trust)", lat: 54.0777, lng: -1.683, notes: "Main NT car park; closes in the evening.", fee: "Pay & display (free for NT members)" },
      { name: "Brimham Rocks overflow car park", lat: 54.0766, lng: -1.6826, notes: "Overflow next to the main car park.", fee: "Pay & display" },
    ],
  },
  {
    id: "bowderstone",
    name: "Bowderstone",
    region: "Lake District",
    lat: 54.5374, lng: -3.1545,
    rock: "Volcanic",
    grades: "f5 – f8B",
    approach: "10 min",
    description:
      "A giant perched boulder in Borrowdale with steep, powerful lines on its overhanging faces.",
    parking: [
      { name: "Quay Foot Quarry car park", lat: 54.5412, lng: -3.1552, notes: "NT car park on the B5289; ~10 min walk south to the stone.", fee: "Pay & display" },
      { name: "Lay-by south of the Bowderstone", lat: 54.5322, lng: -3.1509, notes: "Small free lay-by on the B5289.", fee: "Free" },
    ],
  },
  {
    id: "cromlech-boulders",
    name: "Cromlech Boulders",
    region: "North Wales",
    lat: 53.0935, lng: -4.0485,
    rock: "Rhyolite",
    grades: "f4 – f8A+",
    approach: "1 min",
    description:
      "Roadside boulders in the Llanberis Pass, plus many more blocks scattered up the valley.",
    parking: [
      { name: "Llanberis Pass lay-by (A4086)", lat: 53.0907, lng: -4.0532, notes: "Roadside lay-by below Dinas Cromlech. Fills fast in summer.", fee: "Free" },
      { name: "Lay-bys near Pont y Gromlech", lat: 53.0898, lng: -4.0498, notes: "More spaces along the A4086.", fee: "Free" },
      { name: "Nant Peris park & ride", lat: 53.1095, lng: -4.094, notes: "Use the Sherpa'r Wyddfa bus up the pass when the lay-bys are full.", fee: "Pay & display" },
    ],
  },
  {
    id: "dumbarton",
    name: "Dumbarton Rock",
    region: "Scotland",
    lat: 55.9368, lng: -4.5644,
    rock: "Basalt",
    grades: "f4 – f8C",
    approach: "5 min",
    description:
      "Glasgow's urban bouldering venue with some of Scotland's hardest problems on polished basalt.",
    parking: [
      { name: "Woodyard Road parking", lat: 55.9392, lng: -4.5698, notes: "Short walk to the rock along the river.", fee: "Free" },
    ],
  },
  {
    id: "glen-nevis-steall",
    name: "Glen Nevis – Steall Boulders",
    region: "Scotland",
    lat: 56.774, lng: -4.99,
    rock: "Schist",
    grades: "f4 – f8A",
    approach: "20 min",
    description:
      "Riverside boulders in the gorge and meadows near Steall Falls. Stunning setting and pleasant on hot days.",
    parking: [
      { name: "Glen Nevis road-end car park", lat: 56.7774, lng: -5.0007, notes: "End of the single-track Glen Nevis road; walk east through the gorge.", fee: "Free" },
    ],
  },
  {
    id: "bowden-doors",
    name: "Bowden Doors",
    region: "Northumberland",
    lat: 55.5862, lng: -1.8883,
    rock: "Sandstone",
    grades: "f3 – f7C",
    approach: "5 min",
    description:
      "Long sandstone edge with excellent bouldering on rippled, featured rock. Avoid when damp – the sandstone is fragile.",
    parking: [
      { name: "Roadside, B6349", lat: 55.5844, lng: -1.8836, notes: "Small roadside pull-in; follow the path west to the edge. Don't block field gates.", fee: "Free" },
    ],
  },
  {
    id: "hound-tor",
    name: "Hound Tor",
    region: "Dartmoor",
    lat: 50.5968, lng: -3.7781,
    rock: "Granite",
    grades: "f3 – f7B",
    approach: "5 min",
    description:
      "Rough Dartmoor granite with plenty of easy and mid-grade problems. Friction is great on cold days.",
    parking: [
      { name: "Hound Tor car park", lat: 50.599, lng: -3.782, notes: "Free car park just below the tor.", fee: "Free" },
    ],
  },
  {
    id: "harrisons",
    name: "Harrison's Rocks",
    region: "South East (Southern Sandstone)",
    lat: 51.0993, lng: 0.187,
    rock: "Sandstone",
    grades: "f3 – f7B",
    approach: "10 min",
    description:
      "Soft southern sandstone owned by the BMC. Brush gently, never use resin, and avoid when wet.",
    parking: [
      { name: "Birchden Wood car park", lat: 51.1063, lng: 0.189, notes: "Main car park for Harrison's Rocks; walk south along the track.", fee: "Pay & display" },
      { name: "Roadside parking, Birchden", lat: 51.1069, lng: 0.1832, notes: "Small free area to the west.", fee: "Free" },
    ],
  },
];
