import React, { useRef } from 'react';
import { Modal, SafeAreaView } from 'react-native';
import { WebView } from 'react-native-webview';
import CookieManager from '@react-native-cookies/cookies';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { cookieService } from '../services';

/**
 * 全局登录弹窗，使用 B 站官方登录页面进行扫码或密码登录。
 * 登录成功后会读取 .bilibili.com 域的所有 Cookie，提取 SESSDATA、bili_jct、DedeUserID 等关键字段。
 * 完整的 Cookie 字符串会通过 cookieService.save 保存至安全存储，
 * 并调用 authStore.login(uid) 标记已登录状态。
 */
export const LoginModal = () => {
  const webViewRef = useRef<WebView>(null);
  const { login } = useAuthStore();
  const { loginModalVisible, setLoginModalVisible } = useUIStore();

  const handleNavigationStateChange = async (navState: any) => {
    const url: string = navState.url;
    // 登录成功后 B 站会跳转到主站或移动站页面
    if (url.startsWith('https://www.bilibili.com/') || url.startsWith('https://m.bilibili.com/')) {
      // 停止继续加载
      webViewRef.current?.stopLoading();
      // 读取所有 Cookie（.bilibili.com 域）
      const rawCookies = await CookieManager.get('https://.bilibili.com');
      const cookieStr = Object.entries(rawCookies)
        .map(([k, v]: any) => `${k}=${v.value}`)
        .join('; ');
      // 保存 Cookie 到安全存储
      await cookieService.set(cookieStr);
      // 提取 UID（DedeUserID）
      const uidMatch = cookieStr.match(/DedeUserID=([0-9]+)/);
      const uid = uidMatch ? uidMatch[1] : undefined;
      // 标记登录状态
      await login(uid);
      // 关闭弹窗
      setLoginModalVisible(false);
    }
  };

  return (
    <Modal
      visible={loginModalVisible}
      animationType="slide"
      onRequestClose={() => setLoginModalVisible(false)}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://passport.bilibili.com/login' }}
          onNavigationStateChange={handleNavigationStateChange}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
        />
      </SafeAreaView>
    </Modal>
  );
};
