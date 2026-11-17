const MIB = 1024 * 1024;

export const MAX_UPLOAD_FILE_SIZE = {
  menu_board: 10 * MIB,
  food_photo: 10 * MIB,
  video_clip: 50 * MIB,
} as const;

// Allow space for multipart headers and form fields in addition to the video.
export const MAX_UPLOAD_REQUEST_SIZE = MAX_UPLOAD_FILE_SIZE.video_clip + MIB;
