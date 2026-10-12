export interface BeatMoviePaths {
  lipSyncFile: string;
  soundEffectFile: string;
  movieFile: string;
  animatedVideoFile: string;
}

// Most processed wins: lip-synced > with sound effect > the beat's own clip. A plugin-video beat
// (animated html_tailwind, remotion) owns the `_animated.mp4`; any `.mov` beside it is left over
// from an earlier moviePrompt on the same beat, and the reverse holds for every other beat.
export function beatMovieCandidates(paths: BeatMoviePaths, isPluginVideo: boolean): string[] {
  const ownClip = isPluginVideo ? paths.animatedVideoFile : paths.movieFile;
  return [paths.lipSyncFile, paths.soundEffectFile, ownClip];
}
