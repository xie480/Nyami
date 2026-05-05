const fs = require('fs');
const path = require('path');

const sourceIcon = path.join(__dirname, 'resource', 'icon.png');

// Android
const androidMipmapDirs = [
  'mipmap-mdpi',
  'mipmap-hdpi',
  'mipmap-xhdpi',
  'mipmap-xxhdpi',
  'mipmap-xxxhdpi'
];

androidMipmapDirs.forEach(dir => {
  const targetDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res', dir);
  if (fs.existsSync(targetDir)) {
    fs.copyFileSync(sourceIcon, path.join(targetDir, 'ic_launcher.png'));
    fs.copyFileSync(sourceIcon, path.join(targetDir, 'ic_launcher_round.png'));
  }
});

// iOS
const iosIconDir = path.join(__dirname, 'ios', 'BiliMusic', 'Images.xcassets', 'AppIcon.appiconset');
if (fs.existsSync(iosIconDir)) {
  fs.copyFileSync(sourceIcon, path.join(iosIconDir, 'icon.png'));
  
  const contentsPath = path.join(iosIconDir, 'Contents.json');
  if (fs.existsSync(contentsPath)) {
    const contents = JSON.parse(fs.readFileSync(contentsPath, 'utf8'));
    contents.images.forEach(image => {
      image.filename = 'icon.png';
    });
    fs.writeFileSync(contentsPath, JSON.stringify(contents, null, 2));
  }
}

console.log('Icons updated successfully.');
