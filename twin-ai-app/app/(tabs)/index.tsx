import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { askTwinRag } from '../../services/api';

export default function HomeScreen() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const flatRef = useRef(null);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = { id: Date.now().toString(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    try {
      const answer = await askTwinRag(input, 'local-user');
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'ai', text: answer }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'ai', text: 'Error' }]);
    }
  };

  return (
    <SafeAreaView style={{flex:1, backgroundColor:'#0A0A0A'}}>
      <View style={{padding:16, borderBottomWidth:1, borderBottomColor:'#2A2A2A'}}>
        <Text style={{color:'#FFFFFF', fontSize:24, fontWeight:'bold'}}>AI Twin</Text>
        <Text style={{color:'#FF6B00', fontSize:14}}>Your Genius AI</Text>
      </View>
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={i => i.id}
        style={{flex:1, padding:12}}
        onContentSizeChange={() => flatRef.current?.scrollToEnd()}
        ListEmptyComponent={<Text style={{color:'#888', textAlign:'center', marginTop:40}}>Start chatting...</Text>}
        renderItem={({item}) => (
          <View style={{maxWidth:'80%', padding:12, borderRadius:16, marginBottom:8, backgroundColor: item.role==='user' ? '#FF6B00' : '#1A1A1A', alignSelf: item.role==='user' ? 'flex-end' : 'flex-start'}}>
            <Text style={{color:'#FFFFFF', fontSize:15}}>{item.text}</Text>
          </View>
        )}
      />
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
        <View style={{flexDirection:'row', padding:12, backgroundColor:'#1A1A1A', alignItems:'center'}}>
          <TextInput
            style={{flex:1, color:'#FFF', fontSize:15, paddingHorizontal:12, paddingVertical:8, backgroundColor:'#2A2A2A', borderRadius:20}}
            value={input}
            onChangeText={setInput}
            placeholder="Message..."
            placeholderTextColor="#888"
            onSubmitEditing={send}
          />
          <TouchableOpacity onPress={send} style={{width:44, height:44, backgroundColor:'#FF6B00', borderRadius:22, justifyContent:'center', alignItems:'center', marginLeft:8}}>
            <Text style={{color:'#FFF', fontSize:18}}>➤</Text>
          </TouchableOpacity>
        </View>
        <View style={{alignItems:'center', padding:16, backgroundColor:'#0A0A0A'}}>
          <Text style={{fontSize:40}}>🎤</Text>
          <Text style={{color:'#FF6B00', fontSize:12, marginTop:4}}>Hold to Record</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
