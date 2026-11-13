// Bundle canonical assets with the frontend. Their hashed URLs do not depend on
// the running API process's working directory or its cached ENC asset root.
import dayPNG from '../../../../Presentation_Library/assets/sprites/day_simplified@2x.png?url';
import duskPNG from '../../../../Presentation_Library/assets/sprites/dusk_simplified@2x.png?url';
import nightPNG from '../../../../Presentation_Library/assets/sprites/night_simplified@2x.png?url';
import dayJSON from '../../../../Presentation_Library/assets/sprites/day_simplified@2x.json?url';
import duskJSON from '../../../../Presentation_Library/assets/sprites/dusk_simplified@2x.json?url';
import nightJSON from '../../../../Presentation_Library/assets/sprites/night_simplified@2x.json?url';
import latin from '../../../../Presentation_Library/assets/fonts/Roboto Bold/0-255.pbf?url';
import latinExtended from '../../../../Presentation_Library/assets/fonts/Roboto Bold/256-511.pbf?url';

export const atlasAssets = {
  day:{png:dayPNG,json:dayJSON}, dusk:{png:duskPNG,json:duskJSON}, night:{png:nightPNG,json:nightJSON},
};
/** Redirect only known presentation assets; other map requests retain their URL/auth. */
export function bundledEncAsset(pathname:string):string | undefined {
  const sprite = /^\/enc\/assets\/sprites\/(day|dusk|night)_simplified(?:@2x)?\.(png|json)$/.exec(pathname);
  if(sprite) return atlasAssets[sprite[1] as keyof typeof atlasAssets][sprite[2] as 'png'|'json'];
  if(pathname==='/enc/assets/fonts/Roboto%20Bold/0-255.pbf' || pathname==='/enc/assets/fonts/Roboto Bold/0-255.pbf')return latin;
  if(pathname==='/enc/assets/fonts/Roboto%20Bold/256-511.pbf' || pathname==='/enc/assets/fonts/Roboto Bold/256-511.pbf')return latinExtended;
  return undefined;
}
