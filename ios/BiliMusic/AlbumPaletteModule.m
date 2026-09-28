#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <math.h>
#import <stdlib.h>

static const NSUInteger kMaximumArtworkBytes = 6 * 1024 * 1024;
static const NSUInteger kMaximumArtworkRedirects = 4;

static NSURL *BiliSecureArtworkURL(NSURL *url)
{
  if (url == nil) return nil;
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  NSString *scheme = components.scheme.lowercaseString;
  NSString *host = components.host.lowercaseString;
  NSArray<NSString *> *allowedDomains = @[@"hdslb.com", @"biliimg.com"];
  BOOL allowedHost = NO;
  for (NSString *domain in allowedDomains) {
    if ([host isEqualToString:domain] || [host hasSuffix:[@"." stringByAppendingString:domain]]) {
      allowedHost = YES;
      break;
    }
  }
  BOOL allowedScheme = [scheme isEqualToString:@"https"] ||
      ([scheme isEqualToString:@"http"] && (components.port == nil || components.port.integerValue == 80));
  if (!allowedHost || !allowedScheme || components.user != nil || components.password != nil) {
    return nil;
  }

  // Bilibili cover hosts support HTTPS; strip custom ports and upgrade HTTP URLs.
  components.scheme = @"https";
  components.port = nil;
  return components.URL;
}

@interface AlbumPaletteRequest : NSObject <NSURLSessionDataDelegate, NSURLSessionTaskDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSURLSessionDataTask *task;
@property(nonatomic, strong) NSMutableData *data;
@property(nonatomic, copy) void (^completion)(NSData *data, NSError *error);
@property(nonatomic, strong) NSError *requestError;
@property(nonatomic, assign) NSUInteger redirectCount;
@end

@implementation AlbumPaletteRequest

- (instancetype)initWithRequest:(NSURLRequest *)request completion:(void (^)(NSData *, NSError *))completion
{
  self = [super init];
  if (self) {
    _data = [NSMutableData data];
    _completion = [completion copy];
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.timeoutIntervalForRequest = 6.0;
    configuration.timeoutIntervalForResource = 12.0;
    _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
    _task = [_session dataTaskWithRequest:request];
    [_task resume];
  }
  return self;
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler
{
  if (self.redirectCount >= kMaximumArtworkRedirects) {
    self.requestError = [NSError errorWithDomain:@"AlbumPaletteModule" code:1 userInfo:nil];
    completionHandler(nil);
    return;
  }
  NSURL *safeURL = BiliSecureArtworkURL(request.URL);
  if (safeURL == nil) {
    self.requestError = [NSError errorWithDomain:@"AlbumPaletteModule" code:2 userInfo:nil];
    completionHandler(nil);
    return;
  }
  NSMutableURLRequest *safeRequest = [request mutableCopy];
  safeRequest.URL = safeURL;
  self.redirectCount++;
  completionHandler(safeRequest);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler
{
  if (response.expectedContentLength >= 0 &&
      (NSUInteger)response.expectedContentLength > kMaximumArtworkBytes) {
    self.requestError = [NSError errorWithDomain:@"AlbumPaletteModule" code:3 userInfo:nil];
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
    NSInteger statusCode = ((NSHTTPURLResponse *)response).statusCode;
    if (statusCode < 200 || statusCode >= 300) {
      self.requestError = [NSError errorWithDomain:@"AlbumPaletteModule" code:4 userInfo:nil];
      completionHandler(NSURLSessionResponseCancel);
      return;
    }
  }
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data
{
  if (self.data.length + data.length > kMaximumArtworkBytes) {
    self.requestError = [NSError errorWithDomain:@"AlbumPaletteModule" code:3 userInfo:nil];
    [dataTask cancel];
    return;
  }
  [self.data appendData:data];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error
{
  void (^completion)(NSData *, NSError *) = self.completion;
  NSError *resultError = self.requestError ?: error;
  NSData *resultData = resultError == nil ? [self.data copy] : nil;
  self.completion = nil;
  self.task = nil;
  self.data = nil;
  NSURLSession *finishedSession = self.session;
  self.session = nil;
  [finishedSession finishTasksAndInvalidate];
  if (completion != nil) completion(resultData, resultError);
}

@end

@interface AlbumPaletteModule : NSObject <RCTBridgeModule>
@end

@implementation AlbumPaletteModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(getColors,
                 getColorsForUri:(NSString *)uri
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = BiliSecureArtworkURL([NSURL URLWithString:uri]);
  if (url == nil) {
    reject(@"INVALID_ALBUM_URI", @"Only Bilibili HTTPS artwork URLs are supported", nil);
    return;
  }

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  [request setValue:@"Mozilla/5.0 BiliMusic" forHTTPHeaderField:@"User-Agent"];
  [request setValue:@"https://www.bilibili.com/" forHTTPHeaderField:@"Referer"];

  [[AlbumPaletteRequest alloc] initWithRequest:request completion:^(NSData *data, NSError *error) {
    if (error != nil || data.length == 0) {
      reject(@"ALBUM_PALETTE_ERROR", @"Album artwork is unavailable or exceeded its size limit", error);
      return;
    }

    NSDictionary *options = @{
      (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
      (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize : @64,
      (__bridge NSString *)kCGImageSourceShouldCacheImmediately : @YES,
    };
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    CGImageRef image = source == NULL ? NULL : CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    if (source != NULL) CFRelease(source);
    if (image == NULL) {
      reject(@"ALBUM_PALETTE_ERROR", @"Album artwork could not be decoded", nil);
      return;
    }

    size_t width = CGImageGetWidth(image);
    size_t height = CGImageGetHeight(image);
    size_t bytesPerRow = width * 4;
    uint8_t *pixels = calloc(height * bytesPerRow, sizeof(uint8_t));
    if (pixels == NULL) {
      CGImageRelease(image);
      reject(@"ALBUM_PALETTE_ERROR", @"Could not allocate artwork sample buffer", nil);
      return;
    }
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    if (colorSpace == NULL) {
      free(pixels);
      CGImageRelease(image);
      reject(@"ALBUM_PALETTE_ERROR", @"Could not create artwork color space", nil);
      return;
    }
    CGContextRef context = CGBitmapContextCreate(
        pixels, width, height, 8, bytesPerRow, colorSpace,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(colorSpace);
    if (context == NULL) {
      free(pixels);
      CGImageRelease(image);
      reject(@"ALBUM_PALETTE_ERROR", @"Could not decode artwork pixels", nil);
      return;
    }
    CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
    CGContextRelease(context);
    CGImageRelease(image);

    NSMutableDictionary<NSNumber *, NSMutableArray<NSNumber *> *> *bins = [NSMutableDictionary new];
    uint64_t totalRed = 0, totalGreen = 0, totalBlue = 0, totalPixels = 0;
    for (size_t y = 0; y < height; y++) {
      for (size_t x = 0; x < width; x++) {
        size_t offset = (y * width + x) * 4;
        uint8_t red = pixels[offset];
        uint8_t green = pixels[offset + 1];
        uint8_t blue = pixels[offset + 2];
        uint8_t alpha = pixels[offset + 3];
        if (alpha < 128) continue;

        totalRed += red;
        totalGreen += green;
        totalBlue += blue;
        totalPixels++;

        int keyValue = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
        NSNumber *key = @(keyValue);
        NSMutableArray<NSNumber *> *bin = bins[key];
        if (bin == nil) {
          bins[key] = [@[ @1, @(red), @(green), @(blue) ] mutableCopy];
        } else {
          bin[0] = @(bin[0].unsignedIntegerValue + 1);
          bin[1] = @(bin[1].unsignedIntegerValue + red);
          bin[2] = @(bin[2].unsignedIntegerValue + green);
          bin[3] = @(bin[3].unsignedIntegerValue + blue);
        }
      }
    }
    free(pixels);

    NSArray<NSNumber *> *sortedKeys = [bins.allKeys sortedArrayUsingComparator:^NSComparisonResult(NSNumber *left, NSNumber *right) {
      return [bins[right][0] compare:bins[left][0]];
    }];
    NSArray<NSNumber *> *primaryBin = sortedKeys.count > 0 ? bins[sortedKeys[0]] : nil;
    NSArray<NSNumber *> *secondaryBin = nil;
    for (NSUInteger index = 1; index < sortedKeys.count; index++) {
      NSArray<NSNumber *> *candidate = bins[sortedKeys[index]];
      if ([self distanceBetween:primaryBin and:candidate] >= 54.0) {
        secondaryBin = candidate;
        break;
      }
    }

    UIColor *primary = [self colorFromBin:primaryBin fallback:[UIColor colorWithRed:0.94 green:0.79 blue:0.47 alpha:1]];
    UIColor *secondary = [self colorFromBin:secondaryBin fallback:primary];
    UIColor *average = totalPixels == 0
        ? primary
        : [UIColor colorWithRed:(CGFloat)totalRed / totalPixels / 255.0
                         green:(CGFloat)totalGreen / totalPixels / 255.0
                          blue:(CGFloat)totalBlue / totalPixels / 255.0
                         alpha:1];

    resolve(@{
      @"primary" : [self hexFromColor:primary],
      @"secondary" : [self hexFromColor:secondary],
      @"average" : [self hexFromColor:average],
    });
  }];
}

+ (UIColor *)colorFromBin:(NSArray<NSNumber *> *)bin fallback:(UIColor *)fallback
{
  if (bin.count < 4 || bin[0].unsignedIntegerValue == 0) return fallback;
  CGFloat count = bin[0].doubleValue;
  return [UIColor colorWithRed:bin[1].doubleValue / count / 255.0
                         green:bin[2].doubleValue / count / 255.0
                          blue:bin[3].doubleValue / count / 255.0
                         alpha:1];
}

+ (CGFloat)distanceBetween:(NSArray<NSNumber *> *)first and:(NSArray<NSNumber *> *)second
{
  if (first.count < 4 || second.count < 4) return 0;
  CGFloat firstCount = first[0].doubleValue;
  CGFloat secondCount = second[0].doubleValue;
  CGFloat red = first[1].doubleValue / firstCount - second[1].doubleValue / secondCount;
  CGFloat green = first[2].doubleValue / firstCount - second[2].doubleValue / secondCount;
  CGFloat blue = first[3].doubleValue / firstCount - second[3].doubleValue / secondCount;
  return sqrt(red * red + green * green + blue * blue);
}

+ (NSString *)hexFromColor:(UIColor *)color
{
  CGFloat red = 0, green = 0, blue = 0, alpha = 0;
  [color getRed:&red green:&green blue:&blue alpha:&alpha];
  return [NSString stringWithFormat:@"#%02X%02X%02X",
          (int)round(red * 255), (int)round(green * 255), (int)round(blue * 255)];
}

@end
