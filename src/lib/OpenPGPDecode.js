
/* This is the decode component of the jsOpenPGP library. 
 * Derived from Herbert Hanewinkel's code.
 * Copyright 2011 Sean Colyer, <sean @ colyer . name>
 * Modifications licensed under the GNU General Public License Version 2. 
 * See "LICENSE" document included with this application for full information.
 *  
 *
 * OpenPGP encryption using RSA/AES
 * Copyright 2005-2006 Herbert Hanewinkel, www.haneWIN.de
 * version 2.0, check www.haneWIN.de for the latest version

 * This software is provided as-is, without express or implied warranty.  
 * Permission to use, copy, modify, distribute or sell this software, with or
 * without fee, for any purpose and by any individual or organization, is hereby
 * granted, provided that the above copyright notice and this paragraph appear 
 * in all copies. Distribution as a part of an application or binary must
 * include the above copyright notice in the documentation and/or other
 * materials provided with the application or distribution.
 */

var OpenPGPDecode = {
    bpbl : 16,   // block size in bytes

    // ------------------------
    // String to hex conversion

    str2hex: function(s){
     var hex = "0123456789abcdef";
     var r = '';

     for(var i=0; i<s.length; i++)
     {
      b = s.charCodeAt(i);
      r += hex.charAt((b>>>4)&0xf) + hex.charAt(b&0xf);

     }
     return r;
    },

    hex2str: function(h)
    {
      var s = '';
      for(var i=0; i<h.length; i+=2) 
        s+= String.fromCharCode(parseInt(h.slice(i, i+2), 16));
      return s;
    },

    // GPG CFB symmetric decryption using AES

    GPGdecode: function(key, ciphertext){
     var lsk = key.length;
     var iblock = new Array(this.bpbl);
     var ablock = new Array(this.bpbl);
     var expandedKey = new Array();
     var i, n, text = '';

     keySizeInBits = lsk*8;
     expandedKey = keyExpansion(key);

     // initialisation vector
     for(i=0; i < this.bpbl; i++) iblock[i] = 0;

     iblock = AESencrypt(iblock, expandedKey);
     
     for(i = 0; i < this.bpbl; i++)
     {
      ablock[i] = ciphertext.charCodeAt(i);
      iblock[i] ^= ablock[i];
     }
     
     ablock = AESencrypt(ablock, expandedKey);

     // test check octets
     if(iblock[this.bpbl-2]!=(ablock[0]^ciphertext.charCodeAt(this.bpbl))
     || iblock[this.bpbl-1]!=(ablock[1]^ciphertext.charCodeAt(this.bpbl+1)))
     {
      throw("session key decryption failed");
      return text;
     }

     // resync
     for(i=0; i<this.bpbl; i++) iblock[i] = ciphertext.charCodeAt(i+2);

     for(n=this.bpbl+2; n<ciphertext.length; n+=this.bpbl)
     {
      ablock = AESencrypt(iblock, expandedKey);

      for(i = 0; i<this.bpbl; i++)
      {
       iblock[i] = ciphertext.charCodeAt(n+i);
       text += String.fromCharCode(ablock[i]^iblock[i]); 
      }
     }
     return text;
    },

    decode: function(text, rsa){
      var output = new Array();

      var i=0, len, r='';
      if(text.indexOf('-----BEGIN PGP') == 0)
      {
        var a=text.indexOf('\n');
        if(a>0) a = text.indexOf('\n', a+1);
        var e=text.indexOf('\n='); 
        if(a>0 && e>0) text = text.slice(a+2,e); 
      }
      else{
        throw(gCryptUtil.noArmoredText);
        return;
      }

      var s=r2s(text);

      var iter = 0;
      while(i < s.length)
      {
        output[iter] = new Object();
        r += '\n';

        var tag = s.charCodeAt(i++);

        if((tag&128) == 0) break;

        if(tag&64)
        {
          tag&=63;
          len=s.charCodeAt(i++);
          if(len>191 && len<224) len=((len-192)<<8) + s.charCodeAt(i++);
          else if(len>223 &&len<255) len = (1<<(len&0x1f)); 
          else if(len==255)
             len = (s.charCodeAt(i++)<<24) + (s.charCodeAt(i++)<<16) + (s.charCodeAt(i++)<<8) + s.charCodeAt(i++);
          r+="Tag:"+tag;
        }
        else
        {
          len = tag&3;
          tag = (tag>>>2)&15;
          r+="Tag:"+tag+" Len-Type:"+len;

          if(len==0) len = s.charCodeAt(i++);
          else if(len==1) len = (s.charCodeAt(i++)<<8) + s.charCodeAt(i++);
          else if(len==2)
            len = (s.charCodeAt(i++)<<24) + (s.charCodeAt(i++)<<16) + (s.charCodeAt(i++)<<8) + s.charCodeAt(i++);
          else len = s.length-i-1;
        }
        r+=" Length:"+len;
        output[iter].tag = tag;
        output[iter].len = len;
        
        var start=i;

        if(tag==1)
        {
          
          var r =' => Public Key encrypted session key Packet\n';

          var vers=s.charCodeAt(i++);
          r+="Version:"+vers;
          var id=s.substr(i, 8);
          r+=" KeyId:"+this.str2hex(id);
          i+=8;

          var algo=s.charCodeAt(i++);
          r+=" Algorithm:"+algo+'\n';

          if(algo<1 || algo>3)
          {
            throw('Session key is NOT RSA encrypted');
            break;
          }

          var lb = s.charCodeAt(i)*256 + s.charCodeAt(i+1);
          var lm = Math.floor((lb+7)/8);
          var mod = s.substr(i,lm+2);
          
          i+=lm+2;

          var key = rsa.decrypt(mod).toMPI();
          
          lb = Math.floor((key.charCodeAt(0)*256 + key.charCodeAt(1)+7)/8);
          if(lb+2 != key.length || key.charCodeAt(2) != 2)
          {
            throw('RSA decryption of session key failed');
            break;
          }
          for(l=3;l<key.length;) if(key.charCodeAt(l++) == 0) break;
          if(l+3 >= key.length)
          {
            throw('RSA decryption of session key failed');
            break;
          }
          algo = key.charCodeAt(l++);
          if(algo != 7 && algo != 8 && algo != 9)
          {
            throw('symmectric encryption not AES, AES192, AES256');
            break;
          }
          seskey = key.substr(l, key.length-l-2);
          var c = 0;
          for(var j=0; j<seskey.length; j++) c+=seskey.charCodeAt(j);
          c&=0xffff;
          if(c!=key.charCodeAt(key.length-2)*256+key.charCodeAt(key.length-1))
          {
            throw('session key checksum failed');
            break;
          }
          r+='Sessionkey:'+lb+','+seskey.length+','+this.str2hex(seskey)+'\n';
         output[iter].description = r;
         output[iter].sessionKey = seskey;
        }
        else if(tag==2)
        {
         output[iter].description = ' => Signature Packet\n';
        }
        else if(tag==3)
        {
         output[iter].description = ' => Symmetric-Key Encrypted Session Key Packet\n';
        }
        else if(tag==4)
        {
         output[iter].description = ' => One-Pass Signature Packet\n';
        }
        else if(tag==5 || tag == 7)
        {
          var r =' => Secret Key Packet\n';
          rsa = new RSAKey();

          var vers=s.charCodeAt(i++);
          var time=(s.charCodeAt(i++)<<24) + (s.charCodeAt(i++)<<16) + (s.charCodeAt(i++)<<8) + s.charCodeAt(i++);
          
          r+='Version:'+vers+' Created:'+time;

          if(vers==3)
          {
            var valid=s.charCodeAt(i++)<<8 + s.charCodeAt(i++);
            r+=" Valid:"+valid;
          }

          var algo=s.charCodeAt(i++);
          r+=" Algorithm:"+algo+'\n';

          if(algo<1 || algo>3)
          {
            throw('Algorithm is not RSA\n');
            break;
          }
          var k = i;
          var lm = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
          var mod = new BigInteger(s.substr(i,lm+2),'mpi');//mpi2b(s.substr(i,lm+2));
     
          r+="PK-modulus:"+lm+","+mod+'\n';
          i+=lm+2;
          var le = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
          var exp = new BigInteger(s.substr(i,le+2),'mpi');//mpi2b(s.substr(i,le+2));
          r+="PK-exp:"+le+","+exp+'\n';
          i+=le+2;

    //      r+='---Public Key in Base64---\n'+s2r(s.substr(k,lm+le+4))+'\n---\n';

          var ske=s.charCodeAt(i++);
          var s2k=0;
          var enc=0;
          var hash=1;
          var key = '';
          var pass = ''; 

          r+="SK-Encryption:"+ske+'\n';

          if(ske != 0)
          {
            if(ske==255 || ske==254)
            {
              enc=s.charCodeAt(i++);
              r+="SK-CipherAlgorithm:"+enc+'\n';
           
              s2k=s.charCodeAt(i++);
              hash=s.charCodeAt(i++);

              r+="SK-S2K:"+s2k+' SK-HashAlgorithm:'+hash + '\n';

              if(hash != 2) throw('only SHA-1 implemented');
             
              if(s2k==0)
              {
                pass = window.prompt("Password:", "");

                if(hash == 2) key = str_sha1(pass);
              }
              else if(s2k==1)
              {
                pass = s.substr(i, 8) + window.prompt("Password:", "");;

                r+='salt:'+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','
                          +s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++);

                if(hash == 2) key = str_sha1(pass);
              }
              else if(s2k==3)
              {
                pass = s.substr(i, 8) + window.prompt("Password:", "");

                r+='salt:'+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','
                          +s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++);

                var cnt = s.charCodeAt(i);

                cnt = (16 +(cnt&15)) << (((cnt>>>4)&15)+6);
                var isp = pass;

                while(isp.length < cnt) isp += pass;

                r+= '\nSalt+Password Length:' + pass.length + ' ISP:' + isp.length;

                if(pass.length < cnt) isp = isp.substr(0, cnt);

                r+= ' count:'+ s.charCodeAt(i++) + '=>' + cnt;

                if(hash == 2) key = str_sha1(isp);
              }
              r+='\nKey:';

              var ekey = new Array(16);
              for(var j = 0; j < 16; j++)
              {
                ekey[j] = key.charCodeAt(j);
                r += ' ' + ekey[j];
              }
              r+='\n';

              var ablock = new Array(8);
              var iblock = new Array(8);
              for(var j = 0; j < 8; j++) iblock[j] = s.charCodeAt(i+j);

              r+='IV:'+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+
                      +s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+','+s.charCodeAt(i++)+'\n';

              var elen = start+len-i;
              r+= 'Encrypted data length:' + elen + '\n';

              var cast = new cast5(ekey);
              var text = '';

              for(var n=i; n<start+len; n+=8)
              {
                ablock = cast.Encrypt(iblock);

                for(j=0; j<8; j++)
                {
                  if(n+j >= start+len) break;
                  iblock[j] = s.charCodeAt(n+j);
                  text += String.fromCharCode(ablock[j]^iblock[j]);
                }
              }

              if(ske == 254)
              {
                elen -= 20
                var sha = str_sha1(text.substr(0, elen));
                var n;
                for(n=0; n < 20; n++)
                {
                  if(sha.charCodeAt(n) != text.charCodeAt(elen+n))
                  {
                    r += 'SHA-1 check failed, wrong Password?\n';
                    break;
                  }
                }
                if(n == 20) r += 'SHA-1 check ok\n';
              }
              else
              {
                elen -= 2;
                var sum = 0;
                for(var n = 0; n < elen; n++) sum += text.charCodeAt(n);

                var check = text.charCodeAt(elen)*256 + text.charCodeAt(elen+1);
                if((sum & 65535) == check) r += 'checksum ok\n';
                else r += 'checksum failed\n';
              }

              i = 0;
              var ld = Math.floor((text.charCodeAt(i)*256 + text.charCodeAt(i+1)+7)/8);
              var dkString = text.substr(i,ld+2);
              i+=ld+2;

              var lp = Math.floor((text.charCodeAt(i)*256 + text.charCodeAt(i+1)+7)/8);
              var pkString = text.substr(i,lp+2);
              i+=lp+2;
         
              var lq = Math.floor((text.charCodeAt(i)*256 + text.charCodeAt(i+1)+7)/8);
              var qkString = text.substr(i,lq+2);
              i+=lq+2;
         
              var lu = Math.floor((text.charCodeAt(i)*256 + text.charCodeAt(i+1)+7)/8);
              i+=lu+2;

              rsa.setPrivateAutoComplete(pkString,qkString,dkString);
            }
            else
            {
              r+='---could not decode encrypted private key---\n';
            }
          }
          else
          {
          var ld = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
          var dkString = s.substr(i,ld+2);
          i+=ld+2;

          var lp = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
          var pkString = s.substr(i,lp+2);
          i+=lp+2;
         
          var lq = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
          var qkString = s.substr(i,lq+2);
          i+=lq+2;
         
          var lu = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
          i+=lu+2;

          rsa.setPrivateAutoComplete(pkString,qkString,dkString);
         }
         output[iter].description = r;
         output[iter].rsa = rsa;
       }
       else if(tag==6 || tag ==14)
       {
          var type; var pkey; var fp; var keyid
          var k = i;
          var vers=s.charCodeAt(i++);

          var found = 1;
          
          var time=(s.charCodeAt(i++)<<24) + (s.charCodeAt(i++)<<16) + (s.charCodeAt(i++)<<8) + s.charCodeAt(i++);
          
          if(vers==2 || vers==3) var valid=s.charCodeAt(i++)<<8 + s.charCodeAt(i++);

          var algo=s.charCodeAt(i++);

          if(algo == 1 || algo == 2)
          {
            var m = i;
            var lm = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
            i+=lm+2;

            var mod = s.substr(m,lm+2);
            var le = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
            i+=le+2;

            pkey=s2r(s.substr(m,lm+le+4));
            type="RSA";

            if(vers==3)
            {
               fp='';
               keyid=this.str2hex(mod.substr(mod.length-8, 8));
            }
            else if(vers==4)
            {
              var pkt = String.fromCharCode(0x99) + String.fromCharCode(len>>8) 
                        + String.fromCharCode(len&255)+s.substr(k, len);
              fp = str_sha1(pkt);
              keyid=this.str2hex(fp.substr(fp.length-8,8));
              fp=this.str2hex(fp);
            }
            else
            {
              fp='';
              keyid='';
            }
            found = 2;
          }
          else if((algo == 16 || algo == 20) && vers == 4)
          {
            var m = i;

            var lp = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
            i+=lp+2;

            var lg = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
            i+=lg+2;

            var ly = Math.floor((s.charCodeAt(i)*256 + s.charCodeAt(i+1)+7)/8);
            i+=ly+2;

            pkey=s2r(s.substr(m,lp+lg+ly+6));

            var pkt = String.fromCharCode(0x99) + String.fromCharCode(len>>8) 
                        + String.fromCharCode(len&255)+s.substr(k, len);
            fp = str_sha1(pkt);
            keyid=this.str2hex(fp.substr(fp.length-8,8));
            fp=this.str2hex(fp);
            type="ELGAMAL";
            found = 3;
          } 
          else
          {
            i = k + len;
          }
         output[iter].description = 'Public Key Packet(/Subpacket)';
         output[iter].pkey = pkey;
         output[iter].fp = fp;
         output[iter].vers = vers;
         output[iter].time = time;
         output[iter].algo = algo;
         output[iter].type = type;
         output[iter].keyid = keyid;

       }
       //tag 7 has been grouped with tag 5
       //else if(tag==7)
       //{
       //  output[iter].description = ' => Secret-Subkey Packet\n';
       //}
       else if(tag==8)
       {
         output[iter].description = ' => Compressed Data Packet\n';
       }
       else if(tag==9)
       {
         var r = ' => Symmetrically Encrypted Data Packet\n';

         s = this.GPGdecode(seskey, s.substr(i, len));
         r+= '---Start of decrypted packets---\n';
         i = 0; // decrypted data in packet format
         output[iter].description = r;
         continue;
       }
       else if(tag==11)
       {
         var r= ' => Literal data Packet\n';
      
         var typ=s.charAt(i++);
         r+="LiteralType:"+typ+'\n';
         var l=s.charCodeAt(i++);
         var name = s.substr(i, l);
         i+=l;
         var date = (s.charCodeAt(i++)<<24) + (s.charCodeAt(i++)<<16) + (s.charCodeAt(i++)<<8) + s.charCodeAt(i++);
         r+='File:'+name+'\nDate:'+date+'\n';
         var text=s.substr(i,len-l-6); 
         r+='---Start of literal data---\n'+text+'\n---\n';
         
         output[iter].description = r;
         output[iter].text = text;
         output[iter].name = name;
         output[iter].date = date;
       }
       else if(tag==12)   // user id
       {
         output[iter].description = ' => Trust Packet\n';
       }
       else if(tag==13)   // user id
       {
         output[iter].description = ' => User id Packet\n' + s.substr(i,len)+'\n';
         output[iter].user = s.substr(i,len);
       }
       //14 is now grouped with 6
       else
       {
         r+= '\n';
       }

       i = start+len;
       iter++;
     }
     return output;
    }
}